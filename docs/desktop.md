# Desktop app (Electron)

`desktop/` wraps DevOne in an Electron window. DevOne still needs its Node.js server (server
actions, the SSH terminal over Server-Sent Events) and PostgreSQL, so the desktop app either
**loads a DevOne you already run** or **starts a bundled copy of the server** on `127.0.0.1`.

## Develop

```bash
bun desktop:install   # once: installs Electron into desktop/node_modules
bun dev               # DevOne on http://localhost:3000
bun desktop:dev       # Electron window pointing at it
```

## Build installers

```bash
bun desktop:build
```

This runs `desktop/prepare-server.mjs` (a `BUILD_STANDALONE=true` Next.js build, copied with
`public/` and `.next/static` into `desktop/server`) and then electron-builder, which writes a DMG
(macOS), NSIS installer (Windows) or AppImage (Linux) to `desktop/dist`. Build each platform on
that platform (for example a CI matrix): the server's native modules (`sharp`, `ssh2`'s optional
bindings) are installed for the OS that runs the build.

## Release

The **Desktop** workflow (`.github/workflows/desktop.yml`) ships the app. To release, bump
`version` in the root `package.json` (the desktop app takes its version from there) and merge to
`main`. If no `v<version>` tag exists yet, the workflow builds the macOS (Apple silicon DMG),
Windows (NSIS installer) and Linux (AppImage) installers on their own runners and publishes them as
the GitHub Release `v<version>`. Pushes that keep the version unchanged build nothing; pull requests
that touch `desktop/` build the Linux app only. It can also be run by hand from the Actions tab.

## Configure

On first launch the app writes `config.json` to its data folder and asks you to fill it in:

| OS      | Folder                                         |
| ------- | ---------------------------------------------- |
| macOS   | `~/Library/Application Support/devone-desktop` |
| Windows | `%APPDATA%\devone-desktop`                     |
| Linux   | `~/.config/devone-desktop`                     |

```json
{
  "url": "",
  "databaseUrl": "postgresql://devone:password@localhost:5432/devone",
  "port": 31337,
  "env": { "DEVONE_ALLOW_BOOTSTRAP": "true" }
}
```

- `url`: a hosted DevOne to load instead of the bundled server (the `DEVONE_URL` environment
  variable overrides it). Leave empty to use the bundled server.
- `databaseUrl`: the PostgreSQL database for the bundled server. Apply the migrations to it
  before first use: `DATABASE_URL=… bun db:deploy`.
- `port`: the bundled server listens on `http://127.0.0.1:<port>`, which is also its
  `DEVONE_APP_URL`. Register `http://127.0.0.1:31337/api/auth/<provider>/callback` with GitHub or
  GitLab if you want OAuth sign-in; personal access tokens work without it.
- `env`: any other DevOne environment variables (see `env.example.txt`).

`DEVONE_ENCRYPTION_KEY` is generated on first launch and kept outside the database, encrypted with
the OS keychain (`safeStorage`). On Linux without a keyring it is stored as `encryption-key.txt`,
readable only by you. Back it up: losing it makes stored tokens unrecoverable.

## Limits

- Webhooks can't reach a desktop machine, so pipeline updates won't arrive by push.
- Installers aren't code-signed; macOS Gatekeeper and Windows SmartScreen will warn until signing
  is configured in `desktop/electron-builder.config.cjs` and the certificates are added to the
  workflow as secrets.
