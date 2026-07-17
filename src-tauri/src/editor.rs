use std::path::Path;
use std::process::{Command, Stdio};

struct EditorInvocation {
    programs: Vec<&'static str>,
    args: Vec<String>,
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
    match editor {
        "vscode" => Ok(EditorInvocation {
            programs: vec![
                "/usr/local/bin/code",
                "/opt/homebrew/bin/code",
                "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
                "code",
            ],
            args: vec!["-g".into(), location],
        }),
        "cursor" => Ok(EditorInvocation {
            programs: vec![
                "/usr/local/bin/cursor",
                "/opt/homebrew/bin/cursor",
                "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
                "cursor",
            ],
            args: vec!["-g".into(), location],
        }),
        "zed" => Ok(EditorInvocation {
            programs: vec![
                "/usr/local/bin/zed",
                "/opt/homebrew/bin/zed",
                "/Applications/Zed.app/Contents/MacOS/cli",
                "zed",
            ],
            args: vec![location],
        }),
        "idea" => Ok(EditorInvocation {
            programs: vec![
                "/usr/local/bin/idea",
                "/opt/homebrew/bin/idea",
                "/Applications/IntelliJ IDEA.app/Contents/MacOS/idea",
                "idea",
            ],
            args: vec!["--line".into(), line.to_string(), path.into()],
        }),
        _ => Err(format!("unsupported editor: {editor}")),
    }
}

pub fn open_editor(editor: &str, path: &str, line: u32, col: Option<u32>) -> Result<(), String> {
    if line == 0 {
        return Err("line must be greater than zero".into());
    }
    if !Path::new(path).is_absolute() {
        return Err("source path is not absolute".into());
    }
    if !Path::new(path).is_file() {
        return Err(format!("source file does not exist: {path}"));
    }

    let invocation = editor_invocation(editor, path, line, col)?;
    let mut last_error = None;
    for program in invocation.programs {
        if program.contains('/') && !Path::new(program).is_file() {
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
            .any(|program| program.ends_with("/code")));
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
}
