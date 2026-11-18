// Runs next to the Tauri shell as a child process: starts the database (reusing
// the Electron app's database.js), applies migrations, starts the Next.js server
// and reports progress to the shell on stdout, one line each:
//   STAGE <id> [label]   a startup stage began
//   READY <origin>       the server is up
//   ERROR <message>      startup failed
// It stops everything when the shell closes its stdin (including when the shell
// crashes, so no Postgres is left running) or on SIGTERM/SIGINT.
// Logs go to stderr, which the shell writes to devone.log.
//
// Environment: DEVONE_DATA_DIR, DEVONE_SERVER_DIR, DEVONE_PORT (31337),
// DEVONE_DATABASE_URL (use this PostgreSQL instead of the built-in one; a URL saved from
// the app's settings, database-url.txt in the data folder, wins).
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

// Packaged: database.js sits beside this file. Dev: it's the Electron app's.
const databaseModule = fs.existsSync(path.join(__dirname, 'database.js'))
  ? './database.js'
  : '../desktop/database.js';
const { migrate, startDatabase } = require(databaseModule);

const dataDir = process.env.DEVONE_DATA_DIR;
const serverDir = process.env.DEVONE_SERVER_DIR;
const port = Number(process.env.DEVONE_PORT) || 31337;
const origin = `http://127.0.0.1:${port}`;

let server = null;
let database = null;
let stopping = false;

const say = (line) => process.stdout.write(`${line}\n`);
const log = (message) => process.stderr.write(`${new Date().toISOString()} ${String(message).trimEnd()}\n`);
const stage = (id, label = '') => say(`STAGE ${id} ${label}`.trimEnd());

// Spike only: secrets are plain files readable by the user. A real version
// would use the OS keychain (the `keyring` crate in the shell, passed in here).
function secret(name) {
  const file = path.join(dataDir, `${name}.txt`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const value = crypto.randomBytes(32).toString('base64');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, value, { mode: 0o600 });
  return value;
}

function waitForPort(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => (socket.end(), resolve()));
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`DevOne server did not start on port ${port}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  try {
    server?.kill();
    if (database) await database.stop();
  } catch (error) {
    log(`shutdown: ${error}`);
  }
  process.exit(code);
}

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });

  // The URL saved from the app's database settings, else the environment override.
  const savedUrlFile = path.join(dataDir, 'database-url.txt');
  let databaseUrl =
    (fs.existsSync(savedUrlFile) && fs.readFileSync(savedUrlFile, 'utf8').trim()) ||
    process.env.DEVONE_DATABASE_URL ||
    '';
  stage('database', databaseUrl ? 'Connecting to database' : 'Starting database');
  if (!databaseUrl) {
    database = await startDatabase({ dataDir, secret, log: (m) => log(`[postgres] ${m}`) });
    databaseUrl = database.url;
  }

  stage('migrate');
  await migrate(databaseUrl, path.join(serverDir, 'prisma', 'migrations'));

  stage('server');
  server = spawn(process.execPath, [path.join(serverDir, 'server.js')], {
    cwd: serverDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      DEVONE_APP_URL: origin,
      DATABASE_URL: databaseUrl,
      DEVONE_ENCRYPTION_KEY: secret('encryption-key'),
      DEVONE_ALLOW_BOOTSTRAP: 'true',
      DEVONE_DEMO_MODE: 'false',
      DEVONE_LANDING_PAGE: 'false'
    }
  });
  server.stdout.on('data', (chunk) => log(`[server] ${chunk}`));
  server.stderr.on('data', (chunk) => log(`[server] ${chunk}`));
  server.once('exit', (code) => {
    if (!stopping) {
      say(`ERROR The server exited with code ${code}`);
      shutdown(1);
    }
  });

  await waitForPort();
  stage('open');
  say(`READY ${origin}`);
}

// The shell owns our lifetime: when it closes stdin (or dies), we stop.
process.stdin.on('end', () => shutdown(0));
process.stdin.on('close', () => shutdown(0));
process.stdin.resume();
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

main().catch(async (error) => {
  log(error instanceof Error ? error.stack : error);
  say(`ERROR ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`);
  await shutdown(1);
});
