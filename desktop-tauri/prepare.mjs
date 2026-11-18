// Prepares what the Tauri shell loads and runs.
//   always:               ui/ = the Electron app's boot screen, adapted to Tauri's IPC
//   PREPARE_RUNTIME=1:    src-tauri/runtime/ = everything the packaged app needs next to the shell
//                         (Node binary, supervisor, database.js, Postgres + pg, Next.js standalone server)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const electron = path.join(here, '..', 'desktop');

// --- ui/ ------------------------------------------------------------------
const ui = path.join(here, 'ui');
fs.rmSync(ui, { recursive: true, force: true });
fs.cpSync(path.join(electron, 'ui'), ui, { recursive: true });
fs.rmSync(path.join(ui, 'settings.html'));

const shim = `<script>
(() => {
  const tauri = window.__TAURI__;
  window.devoneSplash = {
    getStages: () => tauri.core.invoke('stages'),
    onStage: (callback) => tauri.event.listen('stage', (event) => callback(event.payload))
  };
  tauri.event.listen('failed', (event) => {
    const log = document.getElementById('log');
    log.replaceChildren();
    const li = document.createElement('li');
    li.style.cssText = 'color: var(--bad); opacity: 1; white-space: normal';
    li.textContent = event.payload;
    log.append(li);
  });
})();
</script>
`;
let html = fs.readFileSync(path.join(ui, 'splash.html'), 'utf8');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, '');
html = html.replace('<script>', `${shim}<script>`);
fs.writeFileSync(path.join(ui, 'index.html'), html);
fs.rmSync(path.join(ui, 'splash.html'));

// --- runtime/ -------------------------------------------------------------
if (process.env.PREPARE_RUNTIME === '1') {
  const runtime = path.join(here, 'src-tauri', 'runtime');
  fs.rmSync(runtime, { recursive: true, force: true });
  fs.mkdirSync(runtime, { recursive: true });

  const server = path.join(electron, 'server');
  if (!fs.existsSync(path.join(server, 'server.js'))) {
    execFileSync('node', [path.join(electron, 'prepare-server.mjs')], { stdio: 'inherit' });
  }
  fs.cpSync(server, path.join(runtime, 'server'), { recursive: true, dereference: true });

  // The Node binary that runs the supervisor and the server. Tauri has no Node of its own.
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  fs.copyFileSync(process.execPath, path.join(runtime, exe));

  fs.copyFileSync(path.join(here, 'supervisor.cjs'), path.join(runtime, 'supervisor.cjs'));
  fs.copyFileSync(path.join(electron, 'database.js'), path.join(runtime, 'database.js'));
  const { dependencies } = JSON.parse(fs.readFileSync(path.join(electron, 'package.json'), 'utf8'));
  fs.writeFileSync(
    path.join(runtime, 'package.json'),
    JSON.stringify({ name: 'devone-runtime', private: true, dependencies }, null, 2)
  );
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: runtime, stdio: 'inherit' });
}
