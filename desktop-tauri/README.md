# DevOne on Tauri (spike)

A working Tauri 2 shell for DevOne, built to answer "what would moving off Electron cost?" It reuses
the Electron app's database code and boot screen (`../desktop/database.js`, `../desktop/ui/`) so the
comparison is about the shell, not a rewrite.

## How it works

```
Tauri shell (Rust, src-tauri/src/main.rs)
  ├─ window: the boot screen from ../desktop/ui, adapted by prepare.mjs
  └─ child process: node supervisor.cjs   (stdin piped; closing it stops everything)
        ├─ ../desktop/database.js  -> embedded Postgres + Prisma migrations
        └─ Next.js standalone server on 127.0.0.1:31337
```

The supervisor prints `STAGE`, `READY` and `ERROR` lines; the shell turns them into events for the
boot screen and, on `READY`, points the window at the server. When the shell exits (or crashes) the
supervisor's stdin closes and it stops the server and Postgres. Logs go to `devone.log` in the app
data folder.

## Run

Needs Rust, the Tauri Linux libraries (`libwebkit2gtk-4.1-dev` etc.), the Electron app's deps
(`cd ../desktop && bun install`) and its built server (`node ../desktop/prepare-server.mjs`).

```bash
npm install
npx tauri dev                          # uses system `node` and ../desktop/server
PREPARE_RUNTIME=1 npx tauri build      # bundles node + supervisor + Postgres + server
```

PostgreSQL refuses to run as root, so run the app as a normal user.

## Measured (Linux x86_64, release build)

| What | Size |
| --- | --- |
| Tauri shell binary | 3.6 MB |
| Bundled `node` (needed: Tauri has no Node) | 118 MB |
| Next.js standalone server | 256 MB |
| `node_modules` (embedded-postgres + pg) | 61 MB |
| **`.deb` installer** | **170 MB** |

The shell is tiny, but the Node binary, the server and Postgres are the same weight under either
shell. Dropping Electron saves its runtime (Chromium, roughly 100 MB or more), not the rest. I did
not build the Electron `.deb` for a side-by-side number.

## Features

Same as the Electron app: first launch asks which database to use, **File > Database connection…**
changes it (test, save, restart), a second launch focuses the running app, and the boot screen shows
the real startup stages. The URL is saved in `database-url.txt` in the app data folder, readable only
by the user (Electron seals it with the OS keychain; the `keyring` crate would do that here).

## CI

`.github/workflows/desktop-tauri.yml` builds on Linux (`.deb`), macOS (`.dmg`) and Windows (NSIS) for
pull requests that touch this folder, uploads the installers as artifacts and publishes nothing. On
Linux it also installs the package and runs `smoke-test.sh` under `xvfb`: the server must answer, and
after the shell is killed with `SIGKILL` no `postgres` or supervisor process may remain.

## Not verified

- **A run.** It compiles and packages on Linux, and the connection check works, but I have not
  launched the app or run `smoke-test.sh`: PostgreSQL needs a non-root user and creating one was
  blocked in the session. The first CI run is the first real test of all of it.
- macOS and Windows builds, and how WebKitGTK / WKWebView render the DevOne UI.

## Left out

OS-keychain secrets, signing and notarization, and a release workflow that publishes installers.
