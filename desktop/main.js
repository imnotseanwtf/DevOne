// DevOne desktop: DevOne as a local application. The app runs its own Next.js
// server on 127.0.0.1 and, unless config.json names another database, its own
// PostgreSQL (database.js) with the data in the app's user data folder. Demo
// mode is always off.
//
// DEVONE_URL or "url" in config.json loads another DevOne instead; `bun desktop:dev`
// uses this against `bun dev` on localhost:3000.
//
// Settings live in config.json in the app's user data folder; see docs/desktop.md.
// The first launch asks which database to use (setup.html); File > Database
// Settings changes it later.
const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  utilityProcess
} = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { migrate, startDatabase } = require('./database');
const {
  databaseUrl: externalDatabaseUrl,
  needsSetup,
  parseDatabaseInput,
  testConnection
} = require('./settings');

const DEFAULT_PORT = 31337;

let serverProcess = null;
let database = null;
let quitting = false;

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
      port: DEFAULT_PORT,
      env: {}
    };
    fs.writeFileSync(file, JSON.stringify(template, null, 2));
    return template;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeConfig(config) {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

// The built-in database has been created by an earlier launch.
function hasBuiltinData() {
  return fs.existsSync(path.join(app.getPath('userData'), 'postgres', 'PG_VERSION'));
}

// Random secrets the app creates once: DEVONE_ENCRYPTION_KEY, which protects stored
// provider tokens and SSH credentials, and the local database's password. They're
// kept with the OS keychain-backed safeStorage, never in the database or in
// config.json. Linux without a keyring (no gnome-keyring or KWallet) has no
// safeStorage, so they fall back to files only the user can read.
// The password of a database chosen on the setup screen is kept the same way.
function secretFiles(name) {
  const dir = app.getPath('userData');
  return { sealed: path.join(dir, `${name}.bin`), plain: path.join(dir, `${name}.txt`) };
}

function readSecret(name) {
  const { sealed, plain } = secretFiles(name);
  if (fs.existsSync(sealed)) return safeStorage.decryptString(fs.readFileSync(sealed));
  // Trimmed only when generated: a database password may end in whitespace.
  if (fs.existsSync(plain)) return fs.readFileSync(plain, 'utf8');
  return null;
}

function writeSecret(name, value) {
  const { sealed, plain } = secretFiles(name);
  fs.mkdirSync(path.dirname(sealed), { recursive: true });
  fs.rmSync(sealed, { force: true });
  fs.rmSync(plain, { force: true });
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(sealed, safeStorage.encryptString(value), { mode: 0o600 });
  } else {
    fs.writeFileSync(plain, value, { mode: 0o600 });
  }
}

function secret(name) {
  const stored = readSecret(name);
  if (stored !== null) return stored.trim();
  const value = crypto.randomBytes(32).toString('base64');
  writeSecret(name, value);
  return value;
}

const EXTERNAL_PASSWORD = 'external-database-password';

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

  let databaseUrl = config.databaseUrl;
  if (!databaseUrl && config.database?.mode === 'external') {
    databaseUrl = externalDatabaseUrl(config.database, readSecret(EXTERNAL_PASSWORD) ?? '');
  }
  if (!databaseUrl) {
    database = await startDatabase({
      dataDir: app.getPath('userData'),
      secret,
      log: (message) => log(`[postgres] ${message}`)
    });
    databaseUrl = database.url;
  }
  await migrate(databaseUrl, path.join(serverDir, 'prisma', 'migrations'));

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
  return origin;
}

const SPLASH = `data:text/html;charset=utf-8,${encodeURIComponent(
  '<!doctype html><title>DevOne</title><body style="margin:0;height:100vh;display:grid;place-items:center;font:15px system-ui;color:#666;background:#fafafa">Starting DevOne…</body>'
)}`;

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
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(SPLASH);
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

// The database setup screen: shown on first launch, from File > Database
// Settings, and when the chosen database can't be reached. Resolves true once
// the choice is saved to config.json.
let setup = null;
let remoteOrigin = null;

function openSetup({ firstRun, reason = '', parent = null }) {
  const win = new BrowserWindow({
    width: 620,
    height: 800,
    minWidth: 480,
    minHeight: 520,
    title: 'DevOne',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    ...(parent ? { parent, modal: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'setup-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());

  let resolve;
  const done = new Promise((r) => (resolve = r));
  setup = { win, firstRun, reason, saved: false };
  win.once('closed', () => {
    const { saved } = setup;
    setup = null;
    resolve(saved);
  });
  win.loadFile(path.join(__dirname, 'setup.html'));
  return done;
}

function finishSetup(saved) {
  if (!setup) return;
  setup.saved = saved;
  setup.win.close();
}

const fromSetup = (event) => setup !== null && event.sender === setup.win.webContents;

// An empty password field keeps the saved password.
const passwordFor = (parsed) => parsed.password || readSecret(EXTERNAL_PASSWORD) || '';

ipcMain.handle('setup:load', (event) => {
  if (!fromSetup(event)) return null;
  const config = readConfig();
  return {
    firstRun: setup.firstRun,
    reason: setup.reason,
    settings: config.database ?? null,
    hasPassword: readSecret(EXTERNAL_PASSWORD) !== null
  };
});

ipcMain.handle('setup:test', async (event, input) => {
  if (!fromSetup(event)) return { ok: false, error: 'Not allowed' };
  let parsed;
  try {
    parsed = parseDatabaseInput(input);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  if (parsed.settings.mode !== 'external') return { ok: false, error: 'Nothing to test' };
  return testConnection(
    parsed.settings,
    passwordFor(parsed),
    parsed.encryptionKey ?? secret('encryption-key')
  );
});

ipcMain.handle('setup:save', async (event, input) => {
  if (!fromSetup(event)) return { ok: false, error: 'Not allowed' };
  let parsed;
  try {
    parsed = parseDatabaseInput(input);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  const { settings, encryptionKey } = parsed;

  if (settings.mode === 'external') {
    const password = passwordFor(parsed);
    const result = await testConnection(
      settings,
      password,
      encryptionKey ?? secret('encryption-key')
    );
    if (!result.ok) return { ok: false, error: result.error };
    if (result.keyMatches === false && !input.confirmKeyMismatch) {
      return {
        ok: false,
        keyMismatch: true,
        error:
          "The encryption key doesn't match the one this database's tokens were saved with, so DevOne couldn't read them."
      };
    }
    writeSecret(EXTERNAL_PASSWORD, password);
    if (encryptionKey && encryptionKey !== secret('encryption-key')) {
      writeSecret('encryption-key', encryptionKey);
    }
  }

  // The setup screen's choice replaces a databaseUrl set by hand in config.json.
  const config = readConfig();
  writeConfig({ ...config, databaseUrl: '', database: settings });
  log(
    `Database set to ${settings.mode === 'external' ? `${settings.host}:${settings.port}/${settings.database}` : 'the built-in one'}`
  );
  finishSetup(true);
  return { ok: true };
});

ipcMain.handle('setup:copy-key', (event) => {
  if (fromSetup(event)) clipboard.writeText(secret('encryption-key'));
});

ipcMain.handle('setup:cancel', (event) => {
  if (fromSetup(event)) finishSetup(false);
});

function restart() {
  app.relaunch();
  app.quit();
}

async function openDatabaseSettings() {
  if (setup) {
    setup.win.focus();
    return;
  }
  if (remoteOrigin) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'This window shows another DevOne server',
      detail: `${remoteOrigin} uses its own database; its administrator sets it up.`
    });
    return;
  }
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (await openSetup({ firstRun: false, parent })) restart();
}

function setMenu() {
  const isMac = process.platform === 'darwin';
  const settingsItem = {
    label: 'Database Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => void openDatabaseSettings()
  };
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: isMac ? [{ role: 'close' }] : [settingsItem, { type: 'separator' }, { role: 'quit' }]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// While the first-launch setup is the only window, closing it must not quit
// the app before the main window opens; quitting is decided by start().
let inFirstSetup = false;

async function start() {
  let config = readConfig();
  const remote = process.env.DEVONE_URL || config.url;
  remoteOrigin = remote ? remote.replace(/\/$/, '') : null;

  if (!remoteOrigin && needsSetup(config, hasBuiltinData())) {
    inFirstSetup = true;
    const saved = await openSetup({ firstRun: true });
    if (!saved) {
      app.quit();
      return;
    }
    config = readConfig();
  }

  const win = createWindow();
  inFirstSetup = false;
  try {
    const origin = remoteOrigin ?? (await startLocalServer(config));
    openDevOne(win, origin);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openDevOne(createWindow(), origin);
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`Startup failed: ${error instanceof Error ? error.stack : detail}`);
    await startupFailed(win, config, detail);
  }
}

// A database chosen on the setup screen that can't be used gets a way out
// besides quitting: fix the settings, or fall back to the built-in database.
async function startupFailed(win, config, detail) {
  const external = config.database?.mode === 'external' && !config.databaseUrl;
  if (!remoteOrigin && external) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'error',
      title: 'DevOne could not start',
      message: `DevOne couldn't use the database at ${config.database.host}`,
      detail: `${detail}\n\nFull log: ${logPath()}`,
      buttons: ['Edit Database Settings', 'Use the Built-in Database', 'Quit'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    if (response === 0) {
      if (await openSetup({ firstRun: false, reason: detail, parent: win })) return restart();
    } else if (response === 1) {
      writeConfig({ ...readConfig(), database: { mode: 'builtin' } });
      return restart();
    }
  } else {
    dialog.showErrorBox('DevOne could not start', `${detail}\n\nFull log: ${logPath()}`);
  }
  app.quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = setup?.win ?? BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    setMenu();
    try {
      await start();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log(`Startup failed: ${error instanceof Error ? error.stack : detail}`);
      dialog.showErrorBox('DevOne could not start', `${detail}\n\nFull log: ${logPath()}`);
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !inFirstSetup) app.quit();
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
