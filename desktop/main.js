// DevOne desktop: DevOne as a local application. The app runs its own Next.js
// server on 127.0.0.1 and, unless config.json names another database, its own
// PostgreSQL (database.js) with the data in the app's user data folder. Demo
// mode is always off.
//
// DEVONE_URL or "url" in config.json loads another DevOne instead; `bun desktop:dev`
// uses this against `bun dev` on localhost:3000.
//
// Settings live in config.json in the app's user data folder; see docs/desktop.md.
// The database connection can also be changed in the app (File > Database
// connection…); that URL is kept sealed like the other secrets.
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  shell,
  utilityProcess
} = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { migrate, startDatabase, testConnection } = require('./database');

const DEFAULT_PORT = 31337;

let serverProcess = null;
let database = null;
let quitting = false;
let choosingDatabase = false;

// The boot screen (ui/splash.html) shows what the app is really doing. Stages are
// kept so a screen that loads after the first one still gets them all.
const splashStages = [];
let mainWindow = null;

function stage(id, label) {
  const message = { id, label, at: Date.now() };
  splashStages.push(message);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('splash:stage', message);
}

ipcMain.handle('splash:stages', (event) => {
  return mainWindow && event.sender === mainWindow.webContents ? splashStages : [];
});

// Window background before the page paints, so there is no white flash.
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#0a0a0b' : '#f4f4f5');

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// Everything the database and server print goes to devone.log in the data
// folder (rewritten on each launch), since a packaged app has no console.
function logPath() {
  return path.join(app.getPath('userData'), 'devone.log');
}

let logStream = null;
function log(message) {
  if (!logStream) {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    logStream = fs.createWriteStream(logPath(), { flags: 'w' });
  }
  const line = `${new Date().toISOString()} ${String(message).trimEnd()}\n`;
  logStream.write(line);
  if (!app.isPackaged) process.stdout.write(line);
}

function readConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const template = {
      url: '',
      databaseUrl: '',
      setupDone: false,
      port: DEFAULT_PORT,
      env: {}
    };
    fs.writeFileSync(file, JSON.stringify(template, null, 2));
    return template;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Random secrets the app creates once: DEVONE_ENCRYPTION_KEY, which protects stored
// provider tokens and SSH credentials, and the local database's password. They're
// kept with the OS keychain-backed safeStorage, never in the database or in
// config.json. Linux without a keyring (no gnome-keyring or KWallet) has no
// safeStorage, so they fall back to files only the user can read.
function sealedPaths(name) {
  const dir = app.getPath('userData');
  return { sealed: path.join(dir, `${name}.bin`), plain: path.join(dir, `${name}.txt`) };
}

function readSealed(name) {
  const { sealed, plain } = sealedPaths(name);
  if (fs.existsSync(sealed)) return safeStorage.decryptString(fs.readFileSync(sealed));
  if (fs.existsSync(plain)) return fs.readFileSync(plain, 'utf8').trim();
  return null;
}

function writeSealed(name, value) {
  const { sealed, plain } = sealedPaths(name);
  fs.mkdirSync(path.dirname(sealed), { recursive: true });
  removeSealed(name);
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(sealed, safeStorage.encryptString(value), { mode: 0o600 });
  } else {
    fs.writeFileSync(plain, value, { mode: 0o600 });
  }
}

function removeSealed(name) {
  const { sealed, plain } = sealedPaths(name);
  fs.rmSync(sealed, { force: true });
  fs.rmSync(plain, { force: true });
}

function secret(name) {
  const existing = readSealed(name);
  if (existing) return existing;
  const value = crypto.randomBytes(32).toString('base64');
  writeSealed(name, value);
  return value;
}

// The PostgreSQL the app should use instead of its built-in one: the URL saved
// from the app's settings, else "databaseUrl" in config.json, else none.
function customDatabaseUrl(config = readConfig()) {
  return readSealed('database-url') || config.databaseUrl || '';
}

// A new install asks where to keep its data before starting anything. An install
// that already has a built-in database, or a database URL, has chosen.
function needsDatabaseChoice(config) {
  if (config.setupDone || customDatabaseUrl(config)) return false;
  return !fs.existsSync(path.join(app.getPath('userData'), 'postgres', 'PG_VERSION'));
}

function markSetupDone() {
  const config = readConfig();
  if (!config.setupDone) {
    fs.writeFileSync(configPath(), JSON.stringify({ ...config, setupDone: true }, null, 2));
  }
}

function maskUrl(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    if (url.password) url.password = '****';
    return url.toString();
  } catch {
    return '';
  }
}

function waitForPort(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`DevOne server did not start on port ${port}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function startLocalServer(config) {
  const port = Number(config.port) || DEFAULT_PORT;
  const origin = `http://127.0.0.1:${port}`;
  const serverDir = app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(__dirname, 'server');

  let databaseUrl = customDatabaseUrl(config);
  stage('database', databaseUrl ? 'Connecting to database' : 'Starting database');
  if (!databaseUrl) {
    database = await startDatabase({
      dataDir: app.getPath('userData'),
      secret,
      log: (message) => log(`[postgres] ${message}`)
    });
    databaseUrl = database.url;
  }
  stage('migrate');
  await migrate(databaseUrl, path.join(serverDir, 'prisma', 'migrations'));
  stage('server');

  serverProcess = utilityProcess.fork(path.join(serverDir, 'server.js'), [], {
    cwd: serverDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      ...config.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      DEVONE_APP_URL: origin,
      DATABASE_URL: databaseUrl,
      DEVONE_ENCRYPTION_KEY: secret('encryption-key'),
      // A local, single-owner app: the first person to sign in becomes its
      // administrator, and it's never the public demo.
      DEVONE_ALLOW_BOOTSTRAP: 'true',
      DEVONE_DEMO_MODE: 'false',
      DEVONE_LANDING_PAGE: 'false'
    }
  });
  serverProcess.stdout?.on('data', (chunk) => log(`[server] ${chunk}`));
  serverProcess.stderr?.on('data', (chunk) => log(`[server] ${chunk}`));
  serverProcess.once('exit', (code) => {
    serverProcess = null;
    if (code !== 0 && !quitting) {
      dialog.showErrorBox(
        'DevOne server stopped',
        `The server exited with code ${code}. Details are in ${logPath()}`
      );
      app.quit();
    }
  });

  await waitForPort(port);
  stage('open');
  return origin;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    // The window and taskbar icon on Windows and Linux (macOS uses the app bundle's).
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: windowBackground(),
    webPreferences: {
      // Only the boot screen gets anything from this; see splash-preload.js.
      preload: path.join(__dirname, 'splash-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'ui', 'splash.html'));
  return win;
}

function openDevOne(win, origin) {
  // Anything outside DevOne (docs, provider pages) opens in the default browser.
  const isInternal = (url) => new URL(url).origin === new URL(origin).origin;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternal(url)) shell.openExternal(url);
    return { action: isInternal(url) ? 'allow' : 'deny' };
  });
  win.loadURL(origin);
}

// The database connection settings: a small modal window (settings.html) that
// talks to the handlers below through settings-preload.js.
let settingsWindow = null;
let settingsFirstRun = false;

function openSettings({ firstRun = false } = {}) {
  if (settingsWindow) {
    settingsWindow.focus();
    return new Promise((resolve) => settingsWindow.once('closed', resolve));
  }
  settingsFirstRun = firstRun;
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  settingsWindow = new BrowserWindow({
    width: 760,
    height: 480,
    useContentSize: true,
    backgroundColor: windowBackground(),
    parent,
    modal: Boolean(parent),
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: firstRun ? 'Welcome to DevOne' : 'Database connection',
    // The window's own title bar and frame follow the OS; the content is ours.
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  settingsWindow.removeMenu();
  settingsWindow.loadFile(path.join(__dirname, 'ui', 'settings.html'), {
    query: firstRun ? { firstRun: '1' } : {}
  });
  return new Promise((resolve) =>
    settingsWindow.once('closed', () => {
      settingsWindow = null;
      resolve();
    })
  );
}

function fromSettingsWindow(event) {
  return Boolean(settingsWindow) && event.sender === settingsWindow.webContents;
}

ipcMain.handle('database:get', (event) => {
  if (!fromSettingsWindow(event)) return null;
  const url = customDatabaseUrl();
  return { custom: Boolean(url), url: maskUrl(url), firstRun: settingsFirstRun };
});

ipcMain.handle('database:test', async (event, url) => {
  if (!fromSettingsWindow(event)) return { ok: false, error: 'Not allowed' };
  try {
    await testConnection(String(url).trim());
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// mode "builtin" goes back to the app's own PostgreSQL; "custom" uses `url`, or the
// URL already saved when `url` is empty. Either way the app restarts to apply it.
ipcMain.handle('database:save', async (event, { mode, url }) => {
  if (!fromSettingsWindow(event)) return { ok: false, error: 'Not allowed' };
  try {
    if (mode === 'custom') {
      const next = String(url ?? '').trim() || customDatabaseUrl();
      if (!next) return { ok: false, error: 'Enter a PostgreSQL connection URL.' };
      await testConnection(next);
      writeSealed('database-url', next);
    } else {
      removeSealed('database-url');
    }
    // A databaseUrl in config.json would otherwise still apply.
    const config = readConfig();
    if (config.databaseUrl) {
      fs.writeFileSync(configPath(), JSON.stringify({ ...config, databaseUrl: '' }, null, 2));
    }
    log(
      `Database connection changed to ${mode === 'custom' ? 'a custom PostgreSQL' : 'the built-in database'}`
    );
    markSetupDone();
    if (settingsFirstRun) {
      // First launch: nothing is running yet, so carry on starting instead of restarting.
      setImmediate(() => settingsWindow?.close());
      return { ok: true, restart: false };
    }
    setImmediate(() => {
      app.relaunch();
      app.quit();
    });
    return { ok: true, restart: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

function buildMenu(canEditDatabase) {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' }] : []),
      {
        label: 'File',
        submenu: [
          {
            label: 'Database connection…',
            enabled: canEditDatabase,
            click: () => void openSettings()
          },
          { type: 'separator' },
          isMac ? { role: 'close' } : { role: 'quit' }
        ]
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  );
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    let win = null;
    let config = null;
    try {
      config = readConfig();
      const remote = process.env.DEVONE_URL || config.url;
      buildMenu(!remote);
      if (!remote && needsDatabaseChoice(config)) {
        choosingDatabase = true;
        await openSettings({ firstRun: true });
        choosingDatabase = false;
        config = readConfig();
      }
      win = createWindow();
      mainWindow = win;
      if (remote) stage('open', 'Opening DevOne');
      const origin = remote ? remote.replace(/\/$/, '') : await startLocalServer(config);

      openDevOne(win, origin);
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) openDevOne(createWindow(), origin);
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log(`Startup failed: ${error instanceof Error ? error.stack : detail}`);
      const message = `${detail}\n\nFull log: ${logPath()}`;
      const remote = process.env.DEVONE_URL || config?.url;
      if (!remote && win) {
        // Let the person fix the database connection (a wrong URL, a server that
        // is down) without editing config.json by hand.
        const { response } = await dialog.showMessageBox(win, {
          type: 'error',
          title: 'DevOne could not start',
          message: 'DevOne could not start',
          detail: message,
          buttons: ['Database connection…', 'Quit'],
          defaultId: 0,
          cancelId: 1
        });
        if (response === 0) await openSettings();
      } else {
        dialog.showErrorBox('DevOne could not start', message);
      }
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    // The first-launch window is the only one until the app has started.
    if (choosingDatabase) return;
    if (process.platform !== 'darwin') app.quit();
  });

  // Stop the server, then shut the database down cleanly before quitting.
  app.on('before-quit', (event) => {
    quitting = true;
    serverProcess?.kill();
    if (!database) return;
    event.preventDefault();
    const { stop } = database;
    database = null;
    stop()
      .catch((error) => log(`[postgres] could not stop cleanly: ${error}`))
      .finally(() => app.quit());
  });
}
