// Checks a PostgreSQL connection URL for the shell's "Test connection" button.
// The URL comes in DEVONE_TEST_URL (not argv, which other users can see).
// Prints "OK" or "ERR <reason>".
const fs = require('node:fs');
const path = require('node:path');
const databaseModule = fs.existsSync(path.join(__dirname, 'database.js'))
  ? './database.js'
  : '../desktop/database.js';
const { testConnection } = require(databaseModule);

testConnection(process.env.DEVONE_TEST_URL || '')
  .then(() => process.stdout.write('OK\n'))
  .catch((error) => process.stdout.write(`ERR ${String(error.message).split('\n')[0]}\n`));
