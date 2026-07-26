use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// directories never worth descending into when resolving a log's relative path
const SKIP_DIRS: [&str; 7] = [
    "node_modules",
    "target",
    "vendor",
    "dist",
    "build",
    "tmp",
    ".git",
];

/// Logger callers often print only the tail of a path (zap: `pkg/file.go:16`).
/// Walk `base` breadth-first and return the first directory where `rel` exists.
fn find_by_suffix(base: &Path, rel: &Path) -> Option<PathBuf> {
    let mut queue = vec![base.to_path_buf()];
    let mut visited = 0usize;
    while let Some(dir) = queue.pop() {
        visited += 1;
        if visited > 5_000 {
            return None; // ponytail: budget walk — huge monorepos just fall back to copy
        }
        let candidate = dir.join(rel);
        if candidate.is_file() {
            return Some(candidate);
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_ref()) {
                continue;
            }
            queue.push(p);
        }
    }
    None
}

struct EditorInvocation {
    /// candidates tried in order; bare names fall through to a PATH lookup
    programs: Vec<String>,
    args: Vec<String>,
}

/// `%LOCALAPPDATA%\Programs\<rest>` — where per-user installers put editors.
#[cfg(windows)]
fn local_programs(rest: &str) -> Option<String> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    Some(format!(r"{base}\Programs\{rest}"))
}

/// `%ProgramFiles%\<rest>` — the machine-wide install location.
#[cfg(windows)]
fn program_files(rest: &str) -> Option<String> {
    let base = std::env::var("ProgramFiles").ok()?;
    Some(format!(r"{base}\{rest}"))
}

/// Editor launchers, most specific location first. Windows deliberately targets
/// the `.exe` and never the `bin\*.cmd` shim: CreateProcess cannot execute a
/// batch file, and the `.exe` accepts the same `-g file:line:col` flag.
#[cfg(windows)]
fn programs_for(editor: &str) -> Vec<String> {
    // bare names are single entries on purpose: the PATH lookup is case-insensitive
    let (relative, bare): (&[&str], &[&str]) = match editor {
        "vscode" => (&[r"Microsoft VS Code\Code.exe"], &["Code.exe"]),
        "cursor" => (&[r"cursor\Cursor.exe"], &["Cursor.exe"]),
        "zed" => (&[r"Zed\zed.exe"], &["zed.exe"]),
        "idea" => (
            &[r"IntelliJ IDEA\bin\idea64.exe"],
            &["idea64.exe", "idea.exe"],
        ),
        _ => (&[], &[]),
    };
    relative
        .iter()
        .flat_map(|rest| [local_programs(rest), program_files(rest)])
        .flatten()
        .chain(bare.iter().map(|b| b.to_string()))
        .collect()
}

#[cfg(not(windows))]
fn programs_for(editor: &str) -> Vec<String> {
    let candidates: &[&str] = match editor {
        "vscode" => &[
            "/usr/local/bin/code",
            "/opt/homebrew/bin/code",
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
            "code",
        ],
        "cursor" => &[
            "/usr/local/bin/cursor",
            "/opt/homebrew/bin/cursor",
            "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
            "cursor",
        ],
        "zed" => &[
            "/usr/local/bin/zed",
            "/opt/homebrew/bin/zed",
            "/Applications/Zed.app/Contents/MacOS/cli",
            "zed",
        ],
        "idea" => &[
            "/usr/local/bin/idea",
            "/opt/homebrew/bin/idea",
            "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea",
            "idea",
        ],
        _ => &[],
    };
    candidates.iter().map(|c| c.to_string()).collect()
}

fn path_with_position(path: &str, line: u32, col: Option<u32>) -> String {
    match col {
        Some(col) => format!("{path}:{line}:{col}"),
        None => format!("{path}:{line}"),
    }
}

fn editor_invocation(
    editor: &str,
    path: &str,
    line: u32,
    col: Option<u32>,
) -> Result<EditorInvocation, String> {
    let location = path_with_position(path, line, col);
    let args = match editor {
        "vscode" | "cursor" => vec!["-g".into(), location],
        "zed" => vec![location],
        "idea" => vec!["--line".into(), line.to_string(), path.into()],
        _ => return Err(format!("unsupported editor: {editor}")),
    };
    Ok(EditorInvocation {
        programs: programs_for(editor),
        args,
    })
}

pub fn open_editor(
    editor: &str,
    path: &str,
    line: u32,
    col: Option<u32>,
    base: Option<&str>,
) -> Result<(), String> {
    if line == 0 {
        return Err("line must be greater than zero".into());
    }
    let mut resolved = PathBuf::from(path);
    if !resolved.is_file() {
        // relative caller path (zap prints only `pkg/file.go`) — locate it under the base dir
        let rel = Path::new(path);
        let found = base
            .filter(|_| rel.is_relative())
            .and_then(|b| find_by_suffix(Path::new(b), rel));
        match found {
            Some(p) => resolved = p,
            None => return Err(format!("source file does not exist: {path}")),
        }
    }
    if !resolved.is_absolute() {
        return Err("source path is not absolute".into());
    }
    let path = resolved.to_string_lossy();
    let invocation = editor_invocation(editor, &path, line, col)?;
    let mut last_error = None;
    for program in &invocation.programs {
        // absolute candidates are location guesses — skip the misses quietly;
        // bare names are left to the OS PATH lookup
        if Path::new(program).is_absolute() && !Path::new(program).is_file() {
            continue;
        }
        match Command::new(program)
            .args(&invocation.args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(_) => return Ok(()),
            Err(error) => last_error = Some(error.to_string()),
        }
    }
    Err(last_error.unwrap_or_else(|| format!("{editor} CLI was not found")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vscode_launch_uses_cli_goto_so_line_and_column_are_not_part_of_the_path() {
        let invocation = editor_invocation("vscode", "/Users/dev/project/src/main.ts", 3, Some(7))
            .expect("supported editor");

        assert_eq!(
            invocation.args,
            vec!["-g", "/Users/dev/project/src/main.ts:3:7"]
        );
        assert!(invocation
            .programs
            .iter()
            .any(|program| program.to_lowercase().contains("code")));
    }

    #[test]
    fn every_supported_editor_offers_at_least_one_launcher_on_this_platform() {
        // a platform-specific programs_for() arm that forgot an editor would
        // otherwise surface only as "CLI was not found" at click time
        for editor in ["vscode", "cursor", "zed", "idea"] {
            let invocation = editor_invocation(editor, "/tmp/main.rs", 1, None).unwrap();
            assert!(!invocation.programs.is_empty(), "{editor} has no launcher");
        }
    }

    #[test]
    fn zed_launch_passes_a_single_path_with_position() {
        let invocation = editor_invocation("zed", "/Users/dev/project/src/main.rs", 18, None)
            .expect("supported editor");

        assert_eq!(invocation.args, vec!["/Users/dev/project/src/main.rs:18"]);
    }

    #[test]
    fn rejects_unknown_editors_instead_of_spawning_arbitrary_programs() {
        assert!(editor_invocation("shell", "/tmp/main.ts", 1, None).is_err());
    }

    #[test]
    fn resolves_a_logger_path_tail_under_a_nested_directory() {
        let base = std::env::temp_dir().join("logmin_suffix_test");
        let nested = base.join("internal/pkg/database");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("postgres.go"), "x").unwrap();

        let found = find_by_suffix(&base, Path::new("database/postgres.go")).unwrap();
        assert!(found.ends_with("internal/pkg/database/postgres.go"));

        assert!(find_by_suffix(&base, Path::new("database/missing.go")).is_none());
        std::fs::remove_dir_all(&base).ok();
    }
}
