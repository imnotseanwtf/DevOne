// DevOne desktop on Tauri (spike). The shell does what Electron's main.js did
// for the window and process lifecycle; the database and server startup stays in
// Node (supervisor.cjs), which reports progress on stdout.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::File,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

#[derive(Clone, Serialize)]
struct Stage {
    id: String,
    label: Option<String>,
    at: u64,
}

#[derive(Default)]
struct Shared {
    stages: Mutex<Vec<Stage>>,
    child: Mutex<Option<Child>>,
}

#[tauri::command]
fn stages(state: State<Shared>) -> Vec<Stage> {
    state.stages.lock().unwrap().clone()
}

struct Runtime {
    node: PathBuf,
    supervisor: PathBuf,
    server_dir: PathBuf,
}

// Dev: the Electron app's built server and the system `node`. Packaged: the
// `runtime` folder bundled beside the app (see prepare.mjs).
fn runtime(app: &AppHandle) -> Runtime {
    if cfg!(debug_assertions) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        Runtime {
            node: std::env::var_os("DEVONE_NODE").map(PathBuf::from).unwrap_or_else(|| "node".into()),
            supervisor: root.join("supervisor.cjs"),
            server_dir: root.join("..").join("desktop").join("server"),
        }
    } else {
        let dir = app.path().resource_dir().expect("resource dir").join("runtime");
        let exe = if cfg!(windows) { "node.exe" } else { "node" };
        Runtime { node: dir.join(exe), supervisor: dir.join("supervisor.cjs"), server_dir: dir.join("server") }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

fn start_supervisor(app: &AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let log = File::create(data_dir.join("devone.log")).map_err(|e| e.to_string())?;
    let rt = runtime(app);

    let mut child = Command::new(&rt.node)
        .arg(&rt.supervisor)
        .env("DEVONE_DATA_DIR", &data_dir)
        .env("DEVONE_SERVER_DIR", &rt.server_dir)
        .stdin(Stdio::piped()) // closing it tells the supervisor to stop, even if we crash
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", rt.node.display()))?;
    let stdout = child.stdout.take().unwrap();
    *app.state::<Shared>().child.lock().unwrap() = Some(child);

    let app = app.clone();
    std::thread::spawn(move || {
        let mut ready = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(rest) = line.strip_prefix("STAGE ") {
                let mut parts = rest.splitn(2, ' ');
                let stage = Stage {
                    id: parts.next().unwrap_or("").to_string(),
                    label: parts.next().filter(|s| !s.is_empty()).map(String::from),
                    at: now_ms(),
                };
                app.state::<Shared>().stages.lock().unwrap().push(stage.clone());
                let _ = app.emit("stage", stage);
            } else if let Some(origin) = line.strip_prefix("READY ") {
                ready = true;
                if let Some(window) = app.get_webview_window("main") {
                    let url = serde_json::to_string(origin).unwrap();
                    let _ = window.eval(&format!("window.location.replace({url})"));
                }
            } else if let Some(message) = line.strip_prefix("ERROR ") {
                let _ = app.emit("failed", format!("{message}. Details are in {}", "devone.log"));
            }
        }
        if !ready {
            let _ = app.emit("failed", "DevOne stopped before it was ready. See devone.log in the app data folder.");
        }
    });
    Ok(())
}

// Closes the supervisor's stdin so it stops the server and Postgres cleanly,
// then waits for it; a hung one is killed.
fn stop_supervisor(app: &AppHandle) {
    let child = app.state::<Shared>().child.lock().unwrap().take();
    if let Some(mut child) = child {
        drop(child.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![stages])
        .setup(|app| {
            if let Err(error) = start_supervisor(app.handle()) {
                let _ = app.emit("failed", error);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building DevOne")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_supervisor(app);
            }
        });
}
