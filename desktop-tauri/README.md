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

## Not verified

- **Running it.** It compiles and packages, but I did not launch it: Postgres needs a non-root user
  and creating one was blocked in the session. Launch it once on a normal machine and check that the
  boot screen advances, the server page loads, and quitting leaves no `postgres` or `node` process.
- Windows and macOS builds, and WebKitGTK / WKWebView rendering of the DevOne UI.

## Left out of the spike

First-run database choice and File > Database connection (the Electron app has them; here
`DEVONE_DATABASE_URL` is the only override), OS-keychain secrets (the spike keeps them in
user-only files), single-instance lock, app menu, signing and the release workflow.
