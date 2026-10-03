// The desktop app's own PostgreSQL: a real Postgres server (embedded-postgres
// ships its binaries per platform) whose data lives in the app's data folder.
// Started with the app, stopped when it quits; DevOne's Prisma migrations are
// applied on every start, so updates migrate the database too.
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

/**
 * Stops a Postgres left running by an earlier DevOne that crashed, which would
 * still hold the data folder. The app is single-instance, so a live server for
 * this folder can only be such a leftover.
 */
function stopLeftoverServer(databaseDir, log) {
  const pidFile = path.join(databaseDir, 'postmaster.pid');
  if (!fs.existsSync(pidFile)) return;
  const pid = Number(fs.readFileSync(pidFile, 'utf8').split(/\r?\n/)[0]);
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 0);
  } catch {
    return; // Not running: Postgres clears the stale pid file itself.
  }
  log(`Stopping a leftover PostgreSQL (pid ${pid}) from an earlier run`);
  try {
    process.kill(pid);
  } catch {
    // Already gone.
  }
}

async function waitForExit(pidFile, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (fs.existsSync(pidFile) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * Starts the embedded Postgres in `dataDir` and returns its connection URL and
 * a stop function. `secret(name)` returns a stored random secret, creating it once.
 * Failures throw an Error that includes Postgres's own recent output.
 */
async function startDatabase({ dataDir, secret, log }) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const databaseDir = path.join(dataDir, 'postgres');
  const isNew = !fs.existsSync(path.join(databaseDir, 'PG_VERSION'));
  const password = secret('database-password');
  const port = await freePort();

  // embedded-postgres rejects with no reason when the server exits, so keep the
  // server's recent output to explain the failure.
  const recent = [];
  const record = (message) => {
    const text = String(message).trimEnd();
    if (!text) return;
    recent.push(text);
    if (recent.length > 40) recent.shift();
    log(text);
  };
  const failure = (what, error) =>
    new Error(
      [
        `${what}${error instanceof Error ? `: ${error.message}` : ''}`,
        '',
        'PostgreSQL output:',
        recent.join('\n') || '(none)'
      ].join('\n')
    );

  const postgres = new EmbeddedPostgres({
    databaseDir,
    port,
    user: USER,
    password,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    // Listen on loopback only; nothing outside this computer can reach it.
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: record,
    onError: record
  });

  if (isNew) {
    // A folder left by an initdb that failed part-way can't be started; begin again.
    fs.rmSync(databaseDir, { recursive: true, force: true });
    try {
      await postgres.initialise();
    } catch (error) {
      fs.rmSync(databaseDir, { recursive: true, force: true });
      throw failure('Could not create the database', error);
    }
  } else {
    stopLeftoverServer(databaseDir, record);
    await waitForExit(path.join(databaseDir, 'postmaster.pid'));
  }

  try {
    await postgres.start();
  } catch (error) {
    throw failure('PostgreSQL stopped while starting', error);
  }

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

  const url = `postgresql://${USER}:${encodeURIComponent(password)}@127.0.0.1:${port}/${DATABASE}`;
  return { url, stop: () => postgres.stop() };
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
