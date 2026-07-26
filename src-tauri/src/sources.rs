//! Source engine: file tail + command runner. I/O and batching only —
//! parsing/level/trace detection happens in the TS worker layer.

use same_file::Handle;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

const QUEUE_CAP: usize = 50_000;
const BATCH_MAX: usize = 500;
const FLUSH_MS: u64 = 33;
const TAIL_POLL_MS: u64 = 100;
const FIRST_ATTACH_TAIL_BYTES: u64 = 64 * 1024;
/// SIGTERM → SIGKILL grace for a cmd source (unix only: Windows has no soft kill)
#[cfg(unix)]
const KILL_GRACE_MS: u64 = 3_000;
/// CREATE_NO_WINDOW — a GUI process spawning a console child flashes a black
/// console window without it.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SourceConfig {
    #[serde(rename = "file")]
    File { path: String },
    #[serde(rename = "cmd")]
    Cmd {
        command: String,
        cwd: Option<String>,
        env: Option<HashMap<String, String>>,
    },
    #[serde(rename = "http")]
    Http {
        url: String,
        headers: Option<HashMap<String, String>>,
    },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatchLine {
    pub seq: u64,
    pub raw: String,
    /// "file" | "out" | "err"
    pub stream: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BatchEvent<'a> {
    source_id: &'a str,
    first_seq: u64,
    lines: &'a [BatchLine],
    dropped: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusEvent<'a> {
    source_id: &'a str,
    /// "live" | "idle" | "error"
    status: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    started_at: Option<u64>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn emit_status(
    app: &AppHandle,
    id: &str,
    status: &str,
    pid: Option<u32>,
    exit_code: Option<i32>,
    error: Option<String>,
    started_at: Option<u64>,
) {
    let _ = app.emit(
        "log:status",
        StatusEvent {
            source_id: id,
            status,
            pid,
            exit_code,
            error,
            started_at,
        },
    );
}

static RUN_TOKEN: AtomicU64 = AtomicU64::new(1);

struct SourceHandle {
    /// distinguishes this start from a later restart of the same id
    token: u64,
    tasks: Vec<tauri::async_runtime::JoinHandle<()>>,
    /// shell pid of a cmd source — `kill_tree` target (None for file/http)
    shell_pid: Option<u32>,
    stdin_tx: Option<mpsc::Sender<String>>,
}

#[derive(Default)]
pub struct SourceManager {
    inner: Mutex<HashMap<String, SourceHandle>>,
}

impl SourceManager {
    pub fn stop(&self, id: &str) {
        let handle = self.inner.lock().unwrap().remove(id);
        if let Some(h) = handle {
            if let Some(pid) = h.shell_pid {
                kill_tree(pid);
            }
            // cmd tasks end themselves once the process dies (pipe EOF /
            // dropped stdin sender); only the endless file-tail loop needs abort
            if h.shell_pid.is_none() {
                for t in h.tasks {
                    t.abort();
                }
            }
        }
    }

    pub fn stop_all(&self) {
        let all: Vec<String> = self.inner.lock().unwrap().keys().cloned().collect();
        for id in all {
            self.stop(&id);
        }
    }

    pub fn stdin_sender(&self, id: &str) -> Option<mpsc::Sender<String>> {
        self.inner
            .lock()
            .unwrap()
            .get(id)
            .and_then(|h| h.stdin_tx.clone())
    }

    fn token_of(&self, id: &str) -> Option<u64> {
        self.inner.lock().unwrap().get(id).map(|h| h.token)
    }

    fn insert(&self, id: String, handle: SourceHandle) {
        // restart of same id: kill previous first
        self.stop(&id);
        self.inner.lock().unwrap().insert(id, handle);
    }

    /// waiter cleanup — only if this entry still belongs to the same run
    fn clear_finished(&self, id: &str, token: u64) {
        let mut map = self.inner.lock().unwrap();
        if map.get(id).is_some_and(|h| h.token == token) {
            map.remove(id);
        }
    }
}

/// Stop a cmd source and everything it spawned (`npm run dev` → node → …).
/// unix: the shell owns its own process group (`process_group(0)`), so one
/// killpg reaches the whole tree.
#[cfg(unix)]
fn kill_tree(pid: u32) {
    let pgid = pid as i32; // process_group(0) → pgid == shell pid
    unsafe {
        libc::killpg(pgid, libc::SIGTERM);
    }
    // grace period then SIGKILL, off-thread so stop() stays snappy
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(KILL_GRACE_MS));
        unsafe {
            if libc::killpg(pgid, 0) == 0 {
                libc::killpg(pgid, libc::SIGKILL);
            }
        }
    });
}

/// windows: no process groups to signal and no SIGTERM equivalent a console
/// child would honour from outside its console, so `taskkill /T` walks the
/// parent-pid tree and `/F` is the only stop that actually lands. Children
/// therefore die without running cleanup handlers — the ports they held are
/// released by the OS, but graceful shutdown hooks do not run.
#[cfg(windows)]
fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

/// Batcher: drains the line queue every FLUSH_MS, emits `log:batch` events.
fn spawn_batcher(
    app: AppHandle,
    id: String,
    mut rx: mpsc::Receiver<BatchLine>,
    dropped: Arc<AtomicU64>,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        use tokio::sync::mpsc::error::TryRecvError;
        let mut tick = tokio::time::interval(Duration::from_millis(FLUSH_MS));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut buf: Vec<BatchLine> = Vec::with_capacity(BATCH_MAX);
        let mut disconnected = false;
        while !disconnected {
            tick.tick().await;
            loop {
                buf.clear();
                while buf.len() < BATCH_MAX {
                    match rx.try_recv() {
                        Ok(line) => buf.push(line),
                        Err(TryRecvError::Empty) => break,
                        Err(TryRecvError::Disconnected) => {
                            // all senders gone (source stopped/died) — final flush, then exit
                            disconnected = true;
                            break;
                        }
                    }
                }
                if buf.is_empty() {
                    break;
                }
                let ev = BatchEvent {
                    source_id: &id,
                    first_seq: buf[0].seq,
                    lines: &buf,
                    dropped: dropped.swap(0, Ordering::Relaxed),
                };
                let _ = app.emit("log:batch", &ev);
                if buf.len() < BATCH_MAX {
                    break; // queue drained
                }
            }
        }
    })
}

/// Send helper: counts drops instead of blocking when the queue is full.
fn push_line(
    tx: &mpsc::Sender<BatchLine>,
    dropped: &AtomicU64,
    seq: &AtomicU64,
    raw: String,
    stream: &'static str,
) {
    let line = BatchLine {
        seq: seq.fetch_add(1, Ordering::Relaxed),
        raw,
        stream,
    };
    if tx.try_send(line).is_err() {
        dropped.fetch_add(1, Ordering::Relaxed);
    }
}

// ─── file tail ────────────────────────────────────────────────────────────

struct TailState {
    /// open reader; `Handle` carries the file identity used for rotation checks
    file: Option<Handle>,
    offset: u64,
    partial: Vec<u8>,
    /// mid-file attach: discard bytes until the first '\n' (torn line)
    skip_torn: bool,
}

/// One poll pass: detect rotation/truncate/appearance, read new complete lines.
/// Pure-ish (fs only, no channels) so the logic is unit-testable.
fn tail_poll(path: &str, st: &mut TailState, first_attach: bool) -> std::io::Result<Vec<String>> {
    // opening up front doubles as the existence check and as the identity probe:
    // a `Handle` compares by (dev, ino) on unix and by volume + file index on
    // Windows, so a same-named replacement file is never mistaken for ours.
    let probe = Handle::from_path(path)?;
    let size = probe.as_file().metadata()?.len();
    let first_open = st.file.is_none();

    if first_open || probe != *st.file.as_ref().unwrap() {
        // first open or rotation (file replaced) — rotation reads from 0
        let mut handle = probe;
        let f = handle.as_file_mut();
        let start = if first_open && first_attach && size > FIRST_ATTACH_TAIL_BYTES {
            size - FIRST_ATTACH_TAIL_BYTES
        } else {
            0
        };
        f.seek(SeekFrom::Start(start))?;
        // if the first attach lands mid-line, walk back to the previous newline
        // so the last (possibly very long) line is not discarded as "torn".
        let mut start = start;
        if first_open && first_attach && start > 0 {
            let mut pos = start as i64;
            let mut byte = [0u8; 1];
            while pos > 0 {
                pos -= 1;
                f.seek(SeekFrom::Start(pos as u64))?;
                if f.read(&mut byte).unwrap_or(0) == 0 {
                    break;
                }
                if byte[0] == b'\n' {
                    start = (pos + 1) as u64;
                    break;
                }
            }
            if pos == 0 {
                start = 0;
            }
            f.seek(SeekFrom::Start(start))?;
        }
        st.file = Some(handle);
        st.offset = start;
        st.partial.clear();
        st.skip_torn = false;
    } else if size < st.offset {
        // truncated in place
        st.file
            .as_mut()
            .unwrap()
            .as_file_mut()
            .seek(SeekFrom::Start(0))?;
        st.offset = 0;
        st.partial.clear();
    }

    let mut lines = Vec::new();
    if size > st.offset {
        let f = st.file.as_mut().unwrap().as_file_mut();
        let mut chunk = vec![0u8; (size - st.offset).min(1 << 20) as usize];
        let n = f.read(&mut chunk)?;
        chunk.truncate(n);
        st.offset += n as u64;
        for b in chunk {
            if st.skip_torn {
                if b == b'\n' {
                    st.skip_torn = false;
                }
                continue;
            }
            if b == b'\n' {
                let raw = String::from_utf8_lossy(&st.partial).into_owned();
                st.partial.clear();
                lines.push(raw);
            } else {
                st.partial.push(b);
            }
        }
    }
    Ok(lines)
}

pub fn start_file(app: AppHandle, manager: &SourceManager, id: String, path: String) {
    let (tx, rx) = mpsc::channel::<BatchLine>(QUEUE_CAP);
    let dropped = Arc::new(AtomicU64::new(0));
    let batcher = spawn_batcher(app.clone(), id.clone(), rx, dropped.clone());

    let id2 = id.clone();
    let dropped2 = dropped.clone();
    let reader = tauri::async_runtime::spawn(async move {
        let seq = AtomicU64::new(0);
        let mut st = TailState {
            file: None,
            offset: 0,
            partial: Vec::new(),
            skip_torn: false,
        };
        let mut first_attach = true;
        let mut was_live = false;
        loop {
            let existed_before = st.file.is_some();
            match tail_poll(&path, &mut st, first_attach) {
                Ok(lines) => {
                    if st.file.is_some() {
                        first_attach = false;
                    }
                    if !was_live {
                        was_live = true;
                        emit_status(&app, &id2, "live", None, None, None, Some(now_ms()));
                    }
                    for raw in lines {
                        push_line(&tx, &dropped2, &seq, raw, "file");
                    }
                }
                Err(_) => {
                    // vanished (rotation gap) or not created yet — keep waiting
                    if existed_before {
                        st.file = None;
                    }
                    if was_live {
                        was_live = false;
                        emit_status(&app, &id2, "idle", None, None, None, None);
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(TAIL_POLL_MS)).await;
        }
    });

    manager.insert(
        id,
        SourceHandle {
            token: RUN_TOKEN.fetch_add(1, Ordering::Relaxed),
            tasks: vec![batcher, reader],
            shell_pid: None,
            stdin_tx: None,
        },
    );
}

// ─── command runner ───────────────────────────────────────────────────────

/// The shell cmd sources run under. `LOGMIN_SHELL` overrides on both platforms.
pub(crate) fn default_shell() -> String {
    static SHELL: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    SHELL
        .get_or_init(|| {
            std::env::var("LOGMIN_SHELL")
                .ok()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(fallback_shell)
        })
        .clone()
}

#[cfg(unix)]
fn fallback_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into())
}

/// PowerShell first (what a Windows dev's own commands assume — cmdlets, not
/// just exes), cmd.exe as the always-present last resort.
#[cfg(windows)]
fn fallback_shell() -> String {
    ["pwsh.exe", "powershell.exe"]
        .into_iter()
        .find(|exe| on_path(exe))
        .map(str::to_string)
        .unwrap_or_else(|| std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into()))
}

#[cfg(windows)]
fn on_path(exe: &str) -> bool {
    std::env::var_os("PATH")
        .is_some_and(|path| std::env::split_paths(&path).any(|dir| dir.join(exe).is_file()))
}

/// Run-one-command flags. Both branches deliberately skip startup files: rc
/// files / profiles without a TTY spew noise straight into the captured log.
#[cfg(unix)]
fn shell_args(_shell: &str, command: &str) -> Vec<String> {
    vec!["-c".into(), command.into()]
}

#[cfg(windows)]
fn shell_args(shell: &str, command: &str) -> Vec<String> {
    if is_cmd_exe(shell) {
        // /D skips the AutoRun registry hook, cmd.exe's answer to an rc file
        vec!["/D".into(), "/C".into(), command.into()]
    } else {
        // no -NonInteractive: the stdin bridge below feeds y/N prompts
        vec![
            "-NoLogo".into(),
            "-NoProfile".into(),
            "-Command".into(),
            command.into(),
        ]
    }
}

#[cfg(windows)]
fn is_cmd_exe(shell: &str) -> bool {
    std::path::Path::new(shell)
        .file_stem()
        .is_some_and(|stem| stem.eq_ignore_ascii_case("cmd"))
}

/// Shell flags for a one-shot helper command that needs the user's real PATH.
#[cfg(unix)]
pub(crate) fn one_shot_args(_shell: &str, command: &str) -> Vec<String> {
    // login shell: a GUI app's PATH misses homebrew/nvm, where docker often lives
    vec!["-lc".into(), command.into()]
}

/// windows: the process PATH is already the user's, no login shell needed.
#[cfg(windows)]
pub(crate) fn one_shot_args(shell: &str, command: &str) -> Vec<String> {
    shell_args(shell, command)
}

/// Keeps a helper command's console window from flashing on Windows.
pub(crate) fn hide_console(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Env captured once from an interactive login shell so commands see the
/// user's real PATH (nvm, homebrew, …). Running every command with `-il`
/// instead pollutes the log: interactive rc files without a TTY spew errors
/// (p10k "setopt monitor", gitstatus init failure) straight into stderr.
#[cfg(unix)]
fn login_shell_env(shell: &str) -> HashMap<String, String> {
    static ENV: std::sync::OnceLock<HashMap<String, String>> = std::sync::OnceLock::new();
    ENV.get_or_init(|| {
        std::process::Command::new(shell)
            .args(["-ilc", "command env -0"])
            .stdin(std::process::Stdio::null())
            .output()
            .map(|o| parse_env0(&o.stdout))
            .unwrap_or_default()
    })
    .clone()
}

/// windows: nothing to snapshot — the process already inherits the user's env.
#[cfg(windows)]
fn login_shell_env(_shell: &str) -> HashMap<String, String> {
    HashMap::new()
}

/// Parse NUL-separated KEY=VALUE pairs (`env -0` output).
#[cfg(unix)]
fn parse_env0(bytes: &[u8]) -> HashMap<String, String> {
    bytes
        .split(|b| *b == 0)
        .filter_map(|kv| {
            let s = String::from_utf8_lossy(kv);
            let (k, v) = s.split_once('=')?;
            Some((k.to_string(), v.to_string()))
        })
        .collect()
}

fn spawn_command_process(
    shell: &str,
    command: &str,
    cwd: Option<&str>,
    env: Option<&HashMap<String, String>>,
) -> Result<tokio::process::Child, String> {
    let mut cmd = tokio::process::Command::new(shell);
    // no startup files per command, so their noise can't leak into the log —
    // the env snapshot below still carries the rc-file PATH
    cmd.args(shell_args(shell, command))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // own process group so kill_tree's killpg reaches the whole tree
    #[cfg(unix)]
    cmd.process_group(0);
    hide_console(&mut cmd);
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    cmd.envs(login_shell_env(shell));
    if let Some(env) = env {
        cmd.envs(env); // per-source env wins over the snapshot
    }
    cmd.spawn().map_err(|e| format!("spawn failed: {e}"))
}

pub fn start_cmd(
    app: AppHandle,
    manager: &SourceManager,
    id: String,
    command: String,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let shell = default_shell();
    let mut child = spawn_command_process(&shell, &command, cwd.as_deref(), env.as_ref())?;
    let pid = child.id().unwrap_or(0);

    let (tx, rx) = mpsc::channel::<BatchLine>(QUEUE_CAP);
    let dropped = Arc::new(AtomicU64::new(0));
    let seq = Arc::new(AtomicU64::new(0));
    let batcher = spawn_batcher(app.clone(), id.clone(), rx, dropped.clone());

    emit_status(&app, &id, "live", Some(pid), None, None, Some(now_ms()));

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut stdin = child.stdin.take();

    let mut tasks = vec![batcher];

    if let Some(p) = stdout {
        let (tx, dropped, seq) = (tx.clone(), dropped.clone(), seq.clone());
        tasks.push(tauri::async_runtime::spawn(async move {
            read_pipe(p, tx, dropped, seq, "out").await;
        }));
    }
    if let Some(p) = stderr {
        let (tx, dropped, seq) = (tx.clone(), dropped.clone(), seq.clone());
        tasks.push(tauri::async_runtime::spawn(async move {
            read_pipe(p, tx, dropped, seq, "err").await;
        }));
    }

    // stdin bridge — small, for y/N prompts; not a terminal emulator
    let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(64);
    tasks.push(tauri::async_runtime::spawn(async move {
        while let Some(line) = stdin_rx.recv().await {
            if let Some(sin) = stdin.as_mut() {
                let _ = sin.write_all(line.as_bytes()).await;
                let _ = sin.write_all(b"\n").await;
                let _ = sin.flush().await;
            }
        }
    }));

    // waiter: report exit, then drop the handle entry. Token guards against a
    // restarted source: a stale waiter from the previous run must stay silent.
    let token = RUN_TOKEN.fetch_add(1, Ordering::Relaxed);
    let app2 = app.clone();
    let id2 = id.clone();
    tasks.push(tauri::async_runtime::spawn(async move {
        let code = child.wait().await.ok().and_then(|s| s.code());
        // give pipe readers a beat to flush the last lines
        tokio::time::sleep(Duration::from_millis(120)).await;
        use tauri::Manager;
        let m = app2.state::<SourceManager>();
        if m.token_of(&id2) == Some(token) {
            emit_status(&app2, &id2, "idle", None, code, None, None);
            m.clear_finished(&id2, token);
        }
    }));

    manager.insert(
        id,
        SourceHandle {
            token,
            tasks,
            shell_pid: Some(pid),
            stdin_tx: Some(stdin_tx),
        },
    );
    Ok(())
}

// ─── http(s) source ───────────────────────────────────────────────────────
// Remote log file over HTTP: poll with Range so only the new tail transfers.
// Covers the plain nginx-served .log case; SSE/chunked streaming is M3.

const HTTP_POLL_MS: u64 = 2_000;
const HTTP_FIRST_TAIL: u64 = 64 * 1024;

/// A 416 with TOTAL == our offset just means "no new bytes" — anything else
/// (file shrank, missing/garbled Content-Range, no offset yet) is a rotation
/// and we reread from the top.
fn range_416_is_rotation(offset: Option<u64>, total: Option<u64>) -> bool {
    offset.is_none() || total.is_none() || total != offset
}

pub fn start_http(
    app: AppHandle,
    manager: &SourceManager,
    id: String,
    url: String,
    headers: Option<HashMap<String, String>>,
) {
    let (tx, rx) = mpsc::channel::<BatchLine>(QUEUE_CAP);
    let dropped = Arc::new(AtomicU64::new(0));
    let batcher = spawn_batcher(app.clone(), id.clone(), rx, dropped.clone());

    let id2 = id.clone();
    let reader = tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::new();
        let seq = AtomicU64::new(0);
        let mut offset: Option<u64> = None;
        let mut partial: Vec<u8> = Vec::new();
        let mut skip_torn = false;
        let mut was_live = false;
        let mut backoff_ms: u64 = HTTP_POLL_MS;

        loop {
            let mut req = client.get(&url);
            if let Some(h) = &headers {
                for (k, v) in h {
                    req = req.header(k, v);
                }
            }
            req = match offset {
                None => req.header("Range", format!("bytes=-{HTTP_FIRST_TAIL}")),
                Some(o) => req.header("Range", format!("bytes={o}-")),
            };

            match req.send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    if status == 416 {
                        // 416 Content-Range: "bytes */TOTAL". TOTAL == offset means no
                        // new bytes since last poll — only reset when the file shrank.
                        let total: Option<u64> = resp
                            .headers()
                            .get("content-range")
                            .and_then(|v| v.to_str().ok())
                            .and_then(|v| v.strip_prefix("bytes */"))
                            .and_then(|v| v.parse().ok());
                        if range_416_is_rotation(offset, total) {
                            offset = Some(0);
                            partial.clear();
                            skip_torn = false;
                        }
                    } else if status == 206 || status == 200 {
                        // 206 Content-Range: "bytes START-END/TOTAL"
                        let range_start: Option<u64> = resp
                            .headers()
                            .get("content-range")
                            .and_then(|v| v.to_str().ok())
                            .and_then(|v| v.strip_prefix("bytes "))
                            .and_then(|v| v.split('-').next())
                            .and_then(|v| v.parse().ok());
                        match resp.bytes().await {
                            Ok(body) => {
                                let (bytes, new_offset) = if status == 206 {
                                    let start = range_start.unwrap_or(0);
                                    if offset.is_none() && start > 0 {
                                        skip_torn = true;
                                    }
                                    (body.to_vec(), start + body.len() as u64)
                                } else {
                                    // server ignored Range → full body every poll
                                    let full = body.to_vec();
                                    let start = match offset {
                                        Some(o) if (o as usize) <= full.len() => o as usize,
                                        Some(_) => 0, // shrank → rotated
                                        None => {
                                            skip_torn = full.len() as u64 > HTTP_FIRST_TAIL;
                                            full.len().saturating_sub(HTTP_FIRST_TAIL as usize)
                                        }
                                    };
                                    (full[start..].to_vec(), full.len() as u64)
                                };
                                offset = Some(new_offset);
                                if !was_live {
                                    was_live = true;
                                    emit_status(
                                        &app,
                                        &id2,
                                        "live",
                                        None,
                                        None,
                                        None,
                                        Some(now_ms()),
                                    );
                                }
                                backoff_ms = HTTP_POLL_MS;
                                for b in bytes {
                                    if skip_torn {
                                        if b == b'\n' {
                                            skip_torn = false;
                                        }
                                        continue;
                                    }
                                    if b == b'\n' {
                                        let raw = String::from_utf8_lossy(&partial).into_owned();
                                        partial.clear();
                                        push_line(&tx, &dropped, &seq, raw, "file");
                                    } else {
                                        partial.push(b);
                                    }
                                }
                            }
                            Err(e) => {
                                was_live = false;
                                emit_status(
                                    &app,
                                    &id2,
                                    "error",
                                    None,
                                    None,
                                    Some(e.to_string()),
                                    None,
                                );
                            }
                        }
                    } else {
                        was_live = false;
                        emit_status(
                            &app,
                            &id2,
                            "error",
                            None,
                            None,
                            Some(format!("HTTP {status} from server")),
                            None,
                        );
                        backoff_ms = (backoff_ms * 2).min(30_000);
                    }
                }
                Err(e) => {
                    was_live = false;
                    emit_status(&app, &id2, "error", None, None, Some(e.to_string()), None);
                    backoff_ms = (backoff_ms * 2).min(30_000);
                }
            }
            tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
        }
    });

    manager.insert(
        id,
        SourceHandle {
            token: RUN_TOKEN.fetch_add(1, Ordering::Relaxed),
            tasks: vec![batcher, reader],
            shell_pid: None,
            stdin_tx: None,
        },
    );
}

async fn read_pipe<R>(
    pipe: R,
    tx: mpsc::Sender<BatchLine>,
    dropped: Arc<AtomicU64>,
    seq: Arc<AtomicU64>,
    stream: &'static str,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut reader = BufReader::new(pipe);
    let mut buf: Vec<u8> = Vec::new();
    loop {
        buf.clear();
        // read_until keeps prompts without trailing newline invisible; accept that
        // for M1 the flush-on-idle refinement is skipped.
        // ponytail: no partial-line flush — prompts lacking "\n" show only after Enter.
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let mut raw = String::from_utf8_lossy(&buf).into_owned();
                while raw.ends_with('\n') || raw.ends_with('\r') {
                    raw.pop();
                }
                push_line(&tx, &dropped, &seq, raw, stream);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fresh() -> TailState {
        TailState {
            file: None,
            offset: 0,
            partial: Vec::new(),
            skip_torn: false,
        }
    }

    /// `echo` is the one line-printer both zsh and PowerShell/cmd agree on
    const ECHO_OK: &str = "echo ok";

    fn poll_all(path: &str, st: &mut TailState) -> Vec<String> {
        tail_poll(path, st, false).unwrap_or_default()
    }

    #[test]
    fn http_416_rotation_detection() {
        // no new bytes since last poll — do NOT reread
        assert!(!range_416_is_rotation(Some(100), Some(100)));
        // file shrank (rotated) — reread from 0
        assert!(range_416_is_rotation(Some(100), Some(40)));
        // missing/garbled Content-Range or no offset yet — play safe, reread
        assert!(range_416_is_rotation(Some(100), None));
        assert!(range_416_is_rotation(None, Some(100)));
    }

    #[test]
    fn tail_reads_appended_lines_and_holds_partial() {
        let dir = std::env::temp_dir().join(format!("logmin-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.log");
        let p = path.to_str().unwrap();
        let mut st = fresh();

        std::fs::write(&path, "one\ntwo\npar").unwrap();
        assert_eq!(poll_all(p, &mut st), vec!["one", "two"]);

        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        f.write_all(b"tial\nthree\n").unwrap();
        assert_eq!(poll_all(p, &mut st), vec!["partial", "three"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn tail_first_attach_keeps_long_final_line() {
        // regression: a final line longer than FIRST_ATTACH_TAIL_BYTES must not
        // be silently discarded because the 64 KB tail lands mid-line.
        let dir = std::env::temp_dir().join(format!("logmin-test-long-{}-end", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("long.log");
        let p = path.to_str().unwrap();

        let prefix = "header line\n";
        let long = "x".repeat(FIRST_ATTACH_TAIL_BYTES as usize + 1_000);
        std::fs::write(&path, format!("{}{}\n", prefix, long)).unwrap();

        let mut st = fresh();
        let lines = tail_poll(p, &mut st, true).unwrap();
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].len(), long.len());
        assert!(lines[0].chars().all(|c| c == 'x'));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn tail_handles_truncate_and_rotation() {
        let dir = std::env::temp_dir().join(format!("logmin-test-rot-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("b.log");
        let p = path.to_str().unwrap();
        let mut st = fresh();

        std::fs::write(&path, "aaa\n").unwrap();
        assert_eq!(poll_all(p, &mut st), vec!["aaa"]);

        // truncate in place
        std::fs::write(&path, "b\n").unwrap();
        assert_eq!(poll_all(p, &mut st), vec!["b"]);

        // rotation: remove + recreate (different file) → read from 0
        std::fs::remove_file(&path).unwrap();
        assert!(tail_poll(p, &mut st, false).is_err()); // gone → reader goes idle
        st.file = None; // reader loop clears the handle on error, mirror that
        std::fs::write(&path, "fresh\n").unwrap();
        assert_eq!(poll_all(p, &mut st), vec!["fresh"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn tail_detects_rename_rotation_while_the_handle_is_still_open() {
        // logrotate's default: `mv app.log app.log.1` then a fresh app.log. The
        // old handle stays readable, so only file identity tells them apart —
        // this is the check Windows has no inode for.
        let dir = std::env::temp_dir().join(format!("logmin-test-mv-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("c.log");
        let p = path.to_str().unwrap();
        let mut st = fresh();

        std::fs::write(&path, "old-one\nold-two\n").unwrap();
        assert_eq!(poll_all(p, &mut st), vec!["old-one", "old-two"]);

        std::fs::rename(&path, dir.join("c.log.1")).unwrap();
        // new file is longer than st.offset, so a size-only check would miss it
        std::fs::write(&path, "brand-new-first-line\n").unwrap();
        assert_eq!(poll_all(p, &mut st), vec!["brand-new-first-line"]);

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn parse_env0_splits_nul_pairs_and_keeps_multiline_values() {
        let env = parse_env0(b"PATH=/a:/b\0MULTI=line1\nline2\0BROKEN\0");
        assert_eq!(env.get("PATH").map(String::as_str), Some("/a:/b"));
        assert_eq!(env.get("MULTI").map(String::as_str), Some("line1\nline2"));
        assert!(!env.contains_key("BROKEN"));
    }

    #[tokio::test]
    async fn command_process_spawns_inside_the_async_runtime() {
        let mut child = spawn_command_process(&default_shell(), ECHO_OK, None, None)
            .expect("command should spawn without a missing-reactor panic");
        let status = child.wait().await.expect("command should finish");
        assert!(status.success());
    }

    #[tokio::test]
    async fn command_output_arrives_as_lines_without_carriage_returns() {
        // end-to-end over the platform's own shell: proves the -c / /C flags and
        // quoting are right, and that Windows CRLF never reaches the UI
        let (tx, mut rx) = mpsc::channel::<BatchLine>(8);
        let mut child = spawn_command_process(&default_shell(), ECHO_OK, None, None).unwrap();
        let stdout = child.stdout.take().expect("piped stdout");
        read_pipe(
            stdout,
            tx,
            Arc::new(AtomicU64::new(0)),
            Arc::new(AtomicU64::new(0)),
            "out",
        )
        .await;

        let line = rx.recv().await.expect("one line of output");
        assert_eq!(line.raw, "ok");
        assert_eq!(line.stream, "out");
        let _ = child.wait().await;
    }

    #[cfg(unix)]
    fn sleep_cmd(_shell: &str) -> &'static str {
        "sleep 30"
    }

    #[cfg(windows)]
    fn sleep_cmd(shell: &str) -> &'static str {
        if is_cmd_exe(shell) {
            "timeout /t 30 /nobreak > nul"
        } else {
            "Start-Sleep -Seconds 30"
        }
    }

    #[tokio::test]
    async fn kill_tree_stops_a_running_command() {
        let shell = default_shell();
        let mut child = spawn_command_process(&shell, sleep_cmd(&shell), None, None).unwrap();
        let pid = child.id().expect("a freshly spawned child has a pid");

        kill_tree(pid);

        let status = tokio::time::timeout(Duration::from_secs(10), child.wait())
            .await
            .expect("kill_tree must stop the shell well before the sleep ends")
            .unwrap();
        assert!(!status.success(), "a killed shell must not report success");
    }

    #[cfg(windows)]
    #[test]
    fn windows_shell_args_match_the_chosen_shell() {
        assert_eq!(
            shell_args(r"C:\Windows\System32\cmd.exe", "npm run dev"),
            vec!["/D", "/C", "npm run dev"]
        );
        // anything else is PowerShell-shaped
        assert_eq!(
            shell_args("pwsh.exe", "npm run dev").last().unwrap(),
            "npm run dev"
        );
        assert!(shell_args("powershell.exe", "x").contains(&"-NoProfile".to_string()));
    }
}
