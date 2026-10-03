# Desktop app (Electron)

`desktop/` is DevOne as an application that runs on your own computer. When it starts it runs:

- its own **PostgreSQL** ([embedded-postgres](https://github.com/leinelissen/embedded-postgres)),
  listening on `127.0.0.1` only, with its data in the app's data folder (below). DevOne's Prisma
  migrations are applied on every start, so updating the app updates the database too.
- the **DevOne server** (the Next.js standalone build) on `http://127.0.0.1:31337`, in demo mode
  off, and shows it in the app window.

Nothing is loaded from a website. The first person to sign in (with a GitHub or GitLab personal
access token) becomes the app's administrator. Git, pipelines and sign-in still talk to GitHub or
GitLab; everything else stays on the machine.

## Develop

```bash
bun desktop:install   # once: installs Electron and the embedded Postgres into desktop/node_modules
bun dev               # DevOne on http://localhost:3000
bun desktop:dev       # Electron window pointing at it
```

To run the full local app (embedded database and bundled server) without packaging it:
`cd desktop && node prepare-server.mjs && bun run start`.

## Build installers

```bash
bun desktop:build
```

This runs `desktop/prepare-server.mjs` (a `BUILD_STANDALONE=true` Next.js build, copied with
`public/`, `.next/static` and `prisma/migrations` into `desktop/server`) and then electron-builder,
which writes to `desktop/dist`:

| OS      | Installer                                                        |
| ------- | ---------------------------------------------------------------- |
| macOS   | `.dmg`                                                           |
| Windows | `.exe` (NSIS)                                                    |
| Linux   | `.deb` (Debian, Ubuntu) and `.rpm` (Fedora, RHEL, openSUSE); `rpmbuild` must be installed |

Build each platform on that platform (for example a CI matrix): the Postgres binaries and the
server's native modules (`sharp`, `ssh2`'s optional bindings) are installed for the OS that runs
the build.

## Release

The **Desktop** workflow (`.github/workflows/desktop.yml`) ships the app. To release, bump
`version` in the root `package.json` (the desktop app takes its version from there) and merge to
`main`. If no `v<version>` tag exists yet, the workflow builds the macOS (Apple silicon DMG),
Windows (NSIS installer) and Linux (`.deb` and `.rpm`) installers on their own runners and
publishes them as the GitHub Release `v<version>`. Pushes that keep the version unchanged build
nothing; pull requests that touch `desktop/` build the Linux packages only. It can also be run by
hand from the Actions tab.

## Data and settings

Everything the app keeps is in its data folder:

| OS      | Folder                                         |
| ------- | ---------------------------------------------- |
| macOS   | `~/Library/Application Support/devone-desktop` |
| Windows | `%APPDATA%\devone-desktop`                     |
| Linux   | `~/.config/devone-desktop`                     |

- `postgres/`: the database. Back up this folder (with the app closed) to back up your data.
- `encryption-key.*`: `DEVONE_ENCRYPTION_KEY`, generated on first launch. It protects stored
  provider tokens and SSH credentials; back it up with the database, since losing it makes them
  unrecoverable.
- `database-password.*`: the local database's password, generated on first launch.
- `devone.log`: what the database and server printed during the last launch. If DevOne can't
  start, the error dialog shows PostgreSQL's own message and points to this file.

Both secrets are encrypted with the OS keychain (`safeStorage`, the `.bin` files). On Linux without
a keyring (gnome-keyring or KWallet) they are stored as `.txt` files readable only by you.

`config.json` is optional; the defaults need no changes:

```json
{
  "url": "",
  "databaseUrl": "",
  "port": 31337,
  "env": {}
}
```

- `databaseUrl`: use this PostgreSQL instead of the built-in one. The app applies the migrations to
  it on start.
- `port`: the local server listens on `http://127.0.0.1:<port>`, which is also its
  `DEVONE_APP_URL`. Register `http://127.0.0.1:31337/api/auth/<provider>/callback` with GitHub or
  GitLab if you want OAuth sign-in; personal access tokens work without it.
- `url`: open another DevOne server instead of running one locally (the `DEVONE_URL` environment
  variable overrides it).
- `env`: any other DevOne environment variables (see `env.example.txt`). Demo mode can't be turned
  on in the desktop app.

## Troubleshooting

- **"DevOne could not start"**: the dialog includes PostgreSQL's output, and `devone.log` (with
  `postgres.log`, the database server's own log) in the data folder has the full launch log. The
  server is started with `pg_ctl`, which also lets it run from a Windows administrator account. A PostgreSQL left running by a DevOne that crashed is stopped
  automatically on the next launch, and a database folder left half-created by a failed first
  launch is created again.

## Limits

- Webhooks can't reach a desktop machine, so pipeline updates won't arrive by push.
- Installers aren't code-signed; macOS Gatekeeper and Windows SmartScreen will warn until signing
  is configured in `desktop/electron-builder.config.cjs` and the certificates are added to the
  workflow as secrets.
