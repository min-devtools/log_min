mod editor;
mod sources;

use sources::{SourceConfig, SourceManager};
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::{AppHandle, Manager, RunEvent, State};

#[cfg(target_os = "macos")]
const OPENED_FILES_READY: &str = "app:open-files-ready";

#[derive(Default)]
struct OpenedFiles(Mutex<Vec<String>>);

impl OpenedFiles {
    fn push(&self, paths: Vec<String>) {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .extend(paths);
    }

    fn take(&self) -> Vec<String> {
        std::mem::take(
            &mut *self
                .0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        )
    }
}

/// macOS delivers Open-With targets as file URLs through `RunEvent::Opened`.
#[cfg(target_os = "macos")]
fn local_paths(urls: Vec<tauri::Url>) -> Vec<String> {
    urls.into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Windows/Linux hand them over as argv instead — no Opened event exists there.
/// Flags are skipped and every candidate must be an existing file, so a stray
/// `--flag` from a dev launch can never become a source.
#[cfg(not(target_os = "macos"))]
fn argv_paths<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .filter(|arg| !arg.starts_with('-') && std::path::Path::new(arg).is_file())
        .collect()
}

#[tauri::command]
fn take_opened_files(files: State<'_, OpenedFiles>) -> Vec<String> {
    files.take()
}

#[tauri::command]
async fn source_start(
    app: AppHandle,
    manager: State<'_, SourceManager>,
    id: String,
    config: SourceConfig,
) -> Result<(), String> {
    match config {
        SourceConfig::File { path } => {
            sources::start_file(app, &manager, id, path);
            Ok(())
        }
        SourceConfig::Cmd { command, cwd, env } => {
            sources::start_cmd(app, &manager, id, command, cwd, env)
        }
        SourceConfig::Http { url, headers } => {
            sources::start_http(app, &manager, id, url, headers);
            Ok(())
        }
    }
}

#[tauri::command]
fn source_stop(manager: State<'_, SourceManager>, id: String) -> Result<(), String> {
    manager.stop(&id);
    Ok(())
}

#[tauri::command]
async fn cmd_stdin(
    manager: State<'_, SourceManager>,
    id: String,
    line: String,
) -> Result<(), String> {
    let tx = manager
        .stdin_sender(&id)
        .ok_or("source is not a running command")?;
    tx.send(line).await.map_err(|_| "stdin closed".to_string())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn list_fonts() -> Result<Vec<String>, String> {
    let out = tokio::process::Command::new("osascript")
        .args([
            "-l",
            "JavaScript",
            "-e",
            r#"ObjC.import("AppKit"); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))"#,
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    let json = String::from_utf8_lossy(&out.stdout);
    let mut fonts: Vec<String> = serde_json::from_str(json.trim()).map_err(|e| e.to_string())?;
    fonts.retain(|f| !f.starts_with('.')); // hidden system families
    fonts.sort();
    Ok(fonts)
}

/// Windows PowerShell (not pwsh — System.Drawing is not guaranteed on .NET
/// Core) enumerates installed families, one name per line.
#[cfg(target_os = "windows")]
#[tauri::command]
async fn list_fonts() -> Result<Vec<String>, String> {
    let mut cmd = tokio::process::Command::new("powershell.exe");
    cmd.args([
        "-NoLogo",
        "-NoProfile",
        "-Command",
        // stdout defaults to the console codepage, which from_utf8_lossy would
        // mangle into replacement chars for CJK/Cyrillic family names
        "[Console]::OutputEncoding = [Text.Encoding]::UTF8; \
         Add-Type -AssemblyName System.Drawing; \
         (New-Object System.Drawing.Text.InstalledFontCollection).Families \
         | ForEach-Object { $_.Name }",
    ]);
    sources::hide_console(&mut cmd);
    let out = cmd.output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_owned());
    }
    let mut fonts: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim().to_owned())
        .filter(|l| !l.is_empty())
        .collect();
    fonts.sort();
    fonts.dedup();
    Ok(fonts)
}

/// Nothing to enumerate without a platform API — the picker falls back to the
/// families the webview already knows.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
async fn list_fonts() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

#[tauri::command]
fn editor_open(
    editor: String,
    path: String,
    line: u32,
    col: Option<u32>,
    base: Option<String>,
) -> Result<(), String> {
    editor::open_editor(&editor, &path, line, col, base.as_deref())
}

/// Buffer export: write text to a path picked via the save dialog.
#[tauri::command]
async fn save_text(path: String, contents: String) -> Result<(), String> {
    tokio::fs::write(&path, contents)
        .await
        .map_err(|e| e.to_string())
}

/// One-shot `docker ps` via the login shell (same PATH resolution as cmd sources).
/// Returns raw `{{json .}}` lines; the frontend parses them.
#[tauri::command]
async fn docker_ps() -> Result<String, String> {
    // the format arg must survive the shell: single quotes on unix, double on
    // Windows where cmd.exe/PowerShell treat `'` as a literal character
    #[cfg(windows)]
    const PS: &str = r#"docker ps --format "{{json .}}""#;
    #[cfg(not(windows))]
    const PS: &str = "docker ps --format '{{json .}}'";

    let shell = sources::default_shell();
    let mut cmd = tokio::process::Command::new(&shell);
    cmd.args(sources::one_shot_args(&shell, PS));
    sources::hide_console(&mut cmd);
    let out = cmd.output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "docker ps failed".into()
        } else {
            err
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SourceManager::default())
        .manage(OpenedFiles::default())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            source_start,
            source_stop,
            cmd_stdin,
            list_fonts,
            editor_open,
            save_text,
            docker_ps,
            take_opened_files
        ])
        .setup(|app| {
            // Open-With on Windows/Linux arrives as argv before the webview
            // exists, so park it for the frontend's take_opened_files() boot call
            // (macOS gets RunEvent::Opened instead, which can also fire later).
            #[cfg(not(target_os = "macos"))]
            {
                let paths = argv_paths(std::env::args().skip(1));
                if !paths.is_empty() {
                    app.state::<OpenedFiles>().push(paths);
                }
            }

            // Custom menu without File > Close Window so ⌘W reaches the webview
            // (used to close the active workspace tab). Edit menu kept for copy/paste.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
                let handle = app.handle();
                let app_menu = Submenu::with_items(
                    handle,
                    "LogMin",
                    true,
                    &[
                        &PredefinedMenuItem::about(handle, None, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::hide(handle, None)?,
                        &PredefinedMenuItem::hide_others(handle, None)?,
                        &PredefinedMenuItem::show_all(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::quit(handle, None)?,
                    ],
                )?;
                let edit = Submenu::with_items(
                    handle,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(handle, None)?,
                        &PredefinedMenuItem::redo(handle, None)?,
                        &PredefinedMenuItem::separator(handle)?,
                        &PredefinedMenuItem::cut(handle, None)?,
                        &PredefinedMenuItem::copy(handle, None)?,
                        &PredefinedMenuItem::paste(handle, None)?,
                        &PredefinedMenuItem::select_all(handle, None)?,
                    ],
                )?;
                let window = Submenu::with_items(
                    handle,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(handle, None)?,
                        &PredefinedMenuItem::maximize(handle, None)?,
                        &PredefinedMenuItem::fullscreen(handle, None)?,
                    ],
                )?;
                let menu = Menu::with_items(handle, &[&app_menu, &edit, &window])?;
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // command sources own process groups — kill them all on app exit
            RunEvent::Exit => app.state::<SourceManager>().stop_all(),
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => {
                let paths = local_paths(urls);
                if paths.is_empty() {
                    return;
                }
                app.state::<OpenedFiles>().push(paths);
                let _ = app.emit(OPENED_FILES_READY, ());
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod opened_file_tests {
    use super::*;

    #[test]
    fn pending_opened_files_are_drained_exactly_once() {
        let files = OpenedFiles::default();
        files.push(vec!["/tmp/one.log".into(), "/tmp/two.jsonl".into()]);

        assert_eq!(files.take(), vec!["/tmp/one.log", "/tmp/two.jsonl"]);
        assert!(files.take().is_empty());
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn argv_open_with_keeps_only_existing_files() {
        let dir = std::env::temp_dir().join(format!("logmin-argv-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let real = dir.join("real.log");
        std::fs::write(&real, "x").unwrap();
        let real = real.to_string_lossy().into_owned();

        let args = vec![
            "--a-dev-flag".to_string(),
            real.clone(),
            dir.to_string_lossy().into_owned(), // a directory is not a log file
            dir.join("missing.log").to_string_lossy().into_owned(),
        ];
        assert_eq!(argv_paths(args), vec![real]);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn opened_event_keeps_only_local_file_urls() {
        let urls = vec![
            tauri::Url::parse("file:///tmp/space%20name.log").unwrap(),
            tauri::Url::parse("https://example.com/remote.log").unwrap(),
        ];

        assert_eq!(local_paths(urls), vec!["/tmp/space name.log"]);
    }
}
