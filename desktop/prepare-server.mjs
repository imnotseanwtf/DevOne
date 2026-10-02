// Builds DevOne as a Next.js standalone server and copies it, with its static
// assets, into desktop/server for electron-builder to package.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(desktop, '..');
const out = path.join(desktop, 'server');

execSync('bun run build', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, BUILD_STANDALONE: 'true', NEXT_TELEMETRY_DISABLED: '1' }
});

rmSync(out, { recursive: true, force: true });
cpSync(path.join(root, '.next/standalone'), out, { recursive: true, verbatimSymlinks: true });
cpSync(path.join(root, '.next/static'), path.join(out, '.next/static'), { recursive: true });
if (existsSync(path.join(root, 'public'))) {
  cpSync(path.join(root, 'public'), path.join(out, 'public'), { recursive: true });
}

process.stdout.write(`Standalone server ready in ${out}\n`);
