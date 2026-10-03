// DevOne desktop: DevOne as a local application. The app runs its own Next.js
// server on 127.0.0.1 and, unless config.json names another database, its own
// PostgreSQL (database.js) with the data in the app's user data folder. Demo
// mode is always off.
//
// DEVONE_URL or "url" in config.json loads another DevOne instead; `bun desktop:dev`
// uses this against `bun dev` on localhost:3000.
//
// Settings live in config.json in the app's user data folder; see docs/desktop.md.
const { app, BrowserWindow, dialog, safeStorage, shell, utilityProcess } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { migrate, startDatabase } = require('./database');

const DEFAULT_PORT = 31337;

let serverProcess = null;
let database = null;
let quitting = false;

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
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

// Random secrets the app creates once: DEVONE_ENCRYPTION_KEY, which protects stored
// provider tokens and SSH credentials, and the local database's password. They're
// kept with the OS keychain-backed safeStorage, never in the database or in
// config.json. Linux without a keyring (no gnome-keyring or KWallet) has no
// safeStorage, so they fall back to files only the user can read.
function secret(name) {
  const sealed = path.join(app.getPath('userData'), `${name}.bin`);
  const plain = path.join(app.getPath('userData'), `${name}.txt`);
  if (fs.existsSync(sealed)) return safeStorage.decryptString(fs.readFileSync(sealed));
  if (fs.existsSync(plain)) return fs.readFileSync(plain, 'utf8').trim();

  const value = crypto.randomBytes(32).toString('base64');
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(sealed, safeStorage.encryptString(value), { mode: 0o600 });
  } else {
    fs.writeFileSync(plain, value, { mode: 0o600 });
  }
  return value;
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

  let databaseUrl = config.databaseUrl;
  if (!databaseUrl) {
    database = await startDatabase({
      dataDir: app.getPath('userData'),
      secret,
      log: (message) => process.stdout.write(`[postgres] ${message}\n`)
    });
    databaseUrl = database.url;
  }
  await migrate(databaseUrl, path.join(serverDir, 'prisma', 'migrations'));

  serverProcess = utilityProcess.fork(path.join(serverDir, 'server.js'), [], {
    cwd: serverDir,
    stdio: 'inherit',
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
  serverProcess.once('exit', (code) => {
    serverProcess = null;
    if (code !== 0 && !quitting) {
      dialog.showErrorBox('DevOne server stopped', `The server exited with code ${code}.`);
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
    try {
      const config = readConfig();
      const win = createWindow();
      const remote = process.env.DEVONE_URL || config.url;
      const origin = remote ? remote.replace(/\/$/, '') : await startLocalServer(config);

      openDevOne(win, origin);
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) openDevOne(createWindow(), origin);
      });
    } catch (error) {
      dialog.showErrorBox('DevOne could not start', String(error?.stack ?? error));
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
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
      .catch((error) => console.error('[postgres] could not stop cleanly', error))
      .finally(() => app.quit());
  });
}
