mod editor;
mod sources;

use sources::{SourceConfig, SourceManager};
use tauri::{AppHandle, Manager, RunEvent, State};

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

#[tauri::command]
async fn list_fonts() -> Result<Vec<String>, String> {
    let out = std::process::Command::new("osascript")
        .args([
            "-l",
            "JavaScript",
            "-e",
            r#"ObjC.import("AppKit"); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))"#,
        ])
        .output()
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

#[tauri::command]
fn editor_open(editor: String, path: String, line: u32, col: Option<u32>) -> Result<(), String> {
    editor::open_editor(&editor, &path, line, col)
}

/// One-shot `docker ps` via the login shell (same PATH resolution as cmd sources).
/// Returns raw `{{json .}}` lines; the frontend parses them.
#[tauri::command]
async fn docker_ps() -> Result<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = std::process::Command::new(shell)
        .args(["-lc", "docker ps --format '{{json .}}'"])
        .output()
        .map_err(|e| e.to_string())?;
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
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            source_start,
            source_stop,
            cmd_stdin,
            list_fonts,
            editor_open,
            docker_ps
        ])
        .setup(|app| {
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
        .run(|app, event| {
            // command sources own process groups — kill them all on app exit
            if let RunEvent::Exit = event {
                app.state::<SourceManager>().stop_all();
            }
        });
}
