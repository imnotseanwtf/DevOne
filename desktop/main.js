// DevOne desktop: an Electron window around the DevOne Next.js server.
//
// Which DevOne the window loads, first match wins:
// - DEVONE_URL or "url" in config.json: that instance. `bun desktop:dev` uses this
//   against `bun dev` on localhost:3000.
// - "databaseUrl" in config.json: the packaged app starts its own Next.js
//   standalone server on 127.0.0.1 against that PostgreSQL database.
// - Otherwise the hosted DevOne at DEFAULT_URL.
//
// Settings live in config.json in the app's user data folder; see docs/desktop.md.
const { app, BrowserWindow, dialog, safeStorage, shell, utilityProcess } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const DEFAULT_URL = 'https://www.dev-one.site';
const DEFAULT_PORT = 31337;

let serverProcess = null;
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
      env: {
        DEVONE_ALLOW_BOOTSTRAP: 'true',
        DEVONE_AUTH_PROVIDERS: 'github,gitlab',
        DEVONE_GITHUB_CLIENT_ID: '',
        DEVONE_GITHUB_CLIENT_SECRET: '',
        DEVONE_GITLAB_CLIENT_ID: '',
        DEVONE_GITLAB_CLIENT_SECRET: ''
      }
    };
    fs.writeFileSync(file, JSON.stringify(template, null, 2));
    return template;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// DEVONE_ENCRYPTION_KEY protects stored provider tokens and SSH credentials.
// Generate it once and keep it in the OS keychain-backed safeStorage, never in
// the database or in config.json. Linux without a keyring (no gnome-keyring or
// KWallet) has no safeStorage, so the key falls back to a file only the user can read.
function encryptionKey() {
  const sealed = path.join(app.getPath('userData'), 'encryption-key.bin');
  const plain = path.join(app.getPath('userData'), 'encryption-key.txt');
  if (fs.existsSync(sealed)) return safeStorage.decryptString(fs.readFileSync(sealed));
  if (fs.existsSync(plain)) return fs.readFileSync(plain, 'utf8').trim();

  const key = crypto.randomBytes(32).toString('base64');
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(sealed, safeStorage.encryptString(key), { mode: 0o600 });
  } else {
    fs.writeFileSync(plain, key, { mode: 0o600 });
  }
  return key;
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

async function startBundledServer(config) {
  const port = Number(config.port) || DEFAULT_PORT;
  const origin = `http://127.0.0.1:${port}`;
  const serverDir = app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(__dirname, 'server');

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
      DATABASE_URL: config.databaseUrl,
      DEVONE_ENCRYPTION_KEY: encryptionKey()
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

function createWindow(origin) {
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

  // Anything outside DevOne (docs, provider pages) opens in the default browser.
  const isInternal = (url) => new URL(url).origin === new URL(origin).origin;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternal(url)) shell.openExternal(url);
    return { action: isInternal(url) ? 'allow' : 'deny' };
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(origin);
  return win;
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
      const remote =
        process.env.DEVONE_URL || config.url || (config.databaseUrl ? '' : DEFAULT_URL);
      const origin = remote ? remote.replace(/\/$/, '') : await startBundledServer(config);

      createWindow(origin);
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow(origin);
      });
    } catch (error) {
      dialog.showErrorBox('DevOne could not start', String(error?.stack ?? error));
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    serverProcess?.kill();
  });
}
