// The desktop app's own PostgreSQL: a real Postgres server (embedded-postgres
// ships its binaries per platform) whose data lives in the app's data folder.
// Started with the app, stopped when it quits; DevOne's Prisma migrations are
// applied on every start, so updates migrate the database too.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { Client } = require('pg');

const DATABASE = 'devone';
const USER = 'devone';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// The Postgres binaries embedded-postgres installs for this platform.
async function binaries() {
  const os = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];
  if (!os) throw new Error(`DevOne's built-in database doesn't support ${process.platform}`);
  return import(`@embedded-postgres/${os}-${process.arch}`);
}

// Runs a Postgres tool and resolves when it exits. Waiting for "exit" rather than
// "close": `pg_ctl start` leaves the server running, and on Windows the server can
// inherit our output pipes, which would then never close.
function run(file, args) {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.once('error', (error) => resolve({ code: -1, output: `${output}${error.message}` }));
    child.once('exit', (code) => {
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code: code ?? -1, output });
    });
  });
}

function tail(file, lines = 40) {
  try {
    return fs.readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/**
 * Starts the embedded Postgres in `dataDir` and returns its connection URL and
 * a stop function. `secret(name)` returns a stored random secret, creating it once.
 *
 * The server is started and stopped with pg_ctl rather than by running postgres
 * directly: on Windows, postgres refuses to run with administrator rights (the
 * app started by its installer, an admin account with UAC off), and pg_ctl drops
 * them first. Failures throw an Error that includes PostgreSQL's own output.
 */
async function startDatabase({ dataDir, secret, log }) {
  const { pg_ctl } = await binaries();
  const databaseDir = path.join(dataDir, 'postgres');
  const logFile = path.join(dataDir, 'postgres.log');
  const isNew = !fs.existsSync(path.join(databaseDir, 'PG_VERSION'));
  const password = secret('database-password');
  const port = await freePort();

  if (isNew) {
    // A folder left by an initdb that failed part-way can't be started; begin again.
    fs.rmSync(databaseDir, { recursive: true, force: true });
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const recent = [];
    const initdb = new EmbeddedPostgres({
      databaseDir,
      user: USER,
      password,
      persistent: true,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: (message) => {
        const text = String(message).trimEnd();
        if (text) recent.push(text);
        log(text);
      },
      onError: (error) => log(String(error))
    });
    try {
      await initdb.initialise();
    } catch (error) {
      fs.rmSync(databaseDir, { recursive: true, force: true });
      throw new Error(
        `Could not create the database: ${error instanceof Error ? error.message : error}\n\n${recent.slice(-20).join('\n')}`,
        { cause: error }
      );
    }
  } else if ((await run(pg_ctl, ['status', '-D', databaseDir])).code === 0) {
    // A server left running by a DevOne that crashed still holds the folder.
    log('Stopping a PostgreSQL left running by an earlier launch');
    await run(pg_ctl, ['stop', '-D', databaseDir, '-m', 'fast', '-w']);
  }

  const started = await run(pg_ctl, [
    'start',
    '-D',
    databaseDir,
    '-l',
    logFile,
    '-w',
    '-t',
    '60',
    '-o',
    `-p ${port} -c listen_addresses=127.0.0.1`
  ]);
  log(started.output);
  if (started.code !== 0) {
    throw new Error(
      `PostgreSQL could not start (pg_ctl exit code ${started.code}).\n\n${started.output.trim()}\n${tail(logFile)}`
    );
  }

  const stop = async () => {
    const stopped = await run(pg_ctl, ['stop', '-D', databaseDir, '-m', 'fast', '-w']);
    log(stopped.output);
  };

  try {
    const admin = new Client({
      connectionString: `postgresql://${USER}:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`
    });
    await admin.connect();
    try {
      const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        DATABASE
      ]);
      if (!rowCount) await admin.query(`CREATE DATABASE "${DATABASE}"`);
    } finally {
      await admin.end();
    }
  } catch (error) {
    await stop();
    throw error;
  }

  const url = `postgresql://${USER}:${encodeURIComponent(password)}@127.0.0.1:${port}/${DATABASE}`;
  return { url, stop };
}

/**
 * Applies prisma/migrations/<name>/migration.sql that haven't run yet, recording
 * them in _prisma_migrations the way `prisma migrate deploy` does, so the two
 * stay interchangeable.
 */
async function migrate(databaseUrl, migrationsDir) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    const { rows } = await client.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
    );
    const applied = new Set(rows.map((row) => row.migration_name));

    const names = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();

    for (const name of names) {
      if (applied.has(name)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
      const id = crypto.randomUUID();
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      await client.query(
        'INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES ($1, $2, $3)',
        [id, checksum, name]
      );
      await client.query(sql);
      await client.query(
        'UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1',
        [id]
      );
    }
  } finally {
    await client.end();
  }
}

module.exports = { startDatabase, migrate };
