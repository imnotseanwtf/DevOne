// DevOne desktop on Tauri (spike). The shell does what Electron's main.js did
// for the window and process lifecycle; the database and server startup stays in
// Node (supervisor.cjs), which reports progress on stdout.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

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
    /// The supervisor has been started (it starts once, after the first-launch choice).
    started: AtomicBool,
    /// The first-launch database window is open.
    first_run: AtomicBool,
}

struct Runtime {
    node: PathBuf,
    supervisor: PathBuf,
    dbtest: PathBuf,
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
            dbtest: root.join("dbtest.cjs"),
            server_dir: root.join("..").join("desktop").join("server"),
        }
    } else {
        let dir = app.path().resource_dir().expect("resource dir").join("runtime");
        let exe = if cfg!(windows) { "node.exe" } else { "node" };
        Runtime {
            node: dir.join(exe),
            supervisor: dir.join("supervisor.cjs"),
            dbtest: dir.join("dbtest.cjs"),
            server_dir: dir.join("server"),
        }
    }
}

fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

// ---- The saved database URL ---------------------------------------------------
// Spike: kept in a file only the user can read. A real version would use the OS
// keychain (the `keyring` crate).

fn url_file(app: &AppHandle) -> PathBuf {
    data_dir(app).join("database-url.txt")
}

fn saved_url(app: &AppHandle) -> Option<String> {
    fs::read_to_string(url_file(app)).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn write_private(path: &Path, contents: &str) -> std::io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)?.write_all(contents.as_bytes())
}

fn mask(url: &str) -> String {
    // scheme://user:password@host/... -> scheme://user:****@host/...
    if let (Some(scheme_end), Some(at)) = (url.find("://"), url.rfind('@')) {
        let userinfo = &url[scheme_end + 3..at];
        if let Some(colon) = userinfo.find(':') {
            return format!("{}{}:****{}", &url[..scheme_end + 3], &userinfo[..colon], &url[at..]);
        }
    }
    url.to_string()
}

/// A new install asks where to keep its data; one that already has a built-in
/// database or a saved choice doesn't.
fn needs_choice(app: &AppHandle) -> bool {
    let dir = data_dir(app);
    !dir.join("setup-done").exists()
        && !dir.join("database-url.txt").exists()
        && !dir.join("postgres").join("PG_VERSION").exists()
}

// ---- Commands for the boot screen and the database window ---------------------

#[tauri::command]
fn stages(state: State<Shared>) -> Vec<Stage> {
    state.stages.lock().unwrap().clone()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseInfo {
    custom: bool,
    url: String,
    first_run: bool,
}

#[tauri::command]
fn get_database(app: AppHandle, state: State<Shared>) -> DatabaseInfo {
    let url = saved_url(&app);
    DatabaseInfo {
        custom: url.is_some(),
        url: url.map(|u| mask(&u)).unwrap_or_default(),
        first_run: state.first_run.load(Ordering::SeqCst),
    }
}

#[derive(Serialize)]
struct Outcome {
    ok: bool,
    error: Option<String>,
    restart: bool,
}

fn fail(message: impl Into<String>) -> Outcome {
    Outcome { ok: false, error: Some(message.into()), restart: false }
}

/// Connects to `url` through a short-lived Node process (dbtest.cjs), which reuses
/// the same check the Electron app makes.
fn test_url(app: &AppHandle, url: &str) -> Result<(), String> {
    let rt = runtime(app);
    let output = Command::new(&rt.node)
        .arg(&rt.dbtest)
        .env("DEVONE_TEST_URL", url)
        .output()
        .map_err(|e| format!("could not run {}: {e}", rt.node.display()))?;
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().last().unwrap_or("");
    if line == "OK" {
        Ok(())
    } else {
        Err(line.strip_prefix("ERR ").unwrap_or("The connection check failed.").to_string())
    }
}

#[tauri::command]
async fn test_database(app: AppHandle, url: String) -> Outcome {
    match test_url(&app, url.trim()) {
        Ok(()) => Outcome { ok: true, error: None, restart: false },
        Err(error) => fail(error),
    }
}

#[tauri::command]
async fn save_database(app: AppHandle, state: State<'_, Shared>, mode: String, url: String) -> Result<Outcome, String> {
    let file = url_file(&app);
    if mode == "custom" {
        let next = if url.trim().is_empty() { saved_url(&app).unwrap_or_default() } else { url.trim().to_string() };
        if next.is_empty() {
            return Ok(fail("Enter a PostgreSQL connection URL."));
        }
        if let Err(error) = test_url(&app, &next) {
            return Ok(fail(error));
        }
        write_private(&file, &next).map_err(|e| e.to_string())?;
    } else {
        let _ = fs::remove_file(&file);
    }
    let _ = fs::write(data_dir(&app).join("setup-done"), "");

    if state.first_run.swap(false, Ordering::SeqCst) {
        // First launch: nothing is running yet, so carry on starting instead of restarting.
        ensure_started(&app);
        if let Some(window) = app.get_webview_window("settings") {
            let _ = window.close();
        }
        return Ok(Outcome { ok: true, error: None, restart: false });
    }
    // Restart so the new database applies; the supervisor stops Postgres on the way out.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        stop_supervisor(&handle);
        handle.restart();
    });
    Ok(Outcome { ok: true, error: None, restart: true })
}

fn open_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Database connection")
        .inner_size(760.0, 480.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .center()
        .build();
}

// ---- The supervisor process ---------------------------------------------------

fn ensure_started(app: &AppHandle) {
    if app.state::<Shared>().started.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Err(error) = start_supervisor(app) {
        let _ = app.emit("failed", error);
    }
}

fn start_supervisor(app: &AppHandle) -> Result<(), String> {
    let data_dir = data_dir(app);
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
                let _ = app.emit("failed", format!("{message}. Details are in devone.log in the app data folder."));
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
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // A second launch focuses the running app instead of starting another database.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .manage(Shared::default())
        .invoke_handler(tauri::generate_handler![stages, get_database, test_database, save_database])
        .on_window_event(|window, event| {
            // Closing the first-launch window without choosing starts the built-in
            // database, and asks again next launch.
            if let WindowEvent::Destroyed = event {
                if window.label() == "settings" {
                    let app = window.app_handle();
                    app.state::<Shared>().first_run.store(false, Ordering::SeqCst);
                    ensure_started(app);
                }
            }
        })
        .setup(|app| {
            let database = MenuItemBuilder::with_id("database", "Database connection…").build(app)?;
            let file = SubmenuBuilder::new(app, "File").item(&database).separator().quit().build()?;
            let edit = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            app.set_menu(MenuBuilder::new(app).items(&[&file, &edit]).build()?)?;
            app.on_menu_event(|app, event| {
                if event.id() == "database" {
                    open_settings(app);
                }
            });

            let handle = app.handle();
            if needs_choice(handle) {
                handle.state::<Shared>().first_run.store(true, Ordering::SeqCst);
                open_settings(handle);
            } else {
                ensure_started(handle);
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
