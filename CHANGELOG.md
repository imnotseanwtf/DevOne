# Changelog

All notable changes to DevOne are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.1] - 2026-10-03

### Fixed

- **Desktop app on Windows**: it no longer fails with "DevOne could not start — undefined" when run with administrator rights (for example when its installer opens it). The built-in database is now started with `pg_ctl`.
- **Desktop app on macOS**: the built-in database's libraries are now set up when the app is built.
- **Desktop app**: if it can't start, the error shows the database's own message and points to `devone.log`; it also recovers from a database left running by a crash or half-created by a failed first launch.

### Changed

- **Desktop app icon**: the installers, app window and Linux launcher now use the DevOne logo instead of Electron's default icon.

## [1.1.0] - 2026-10-03

### Added

- **Desktop app** for macOS, Windows and Linux (`.deb` and `.rpm`). It runs DevOne on your own computer with its own built-in PostgreSQL, so it needs no server or website; the first person to sign in becomes its administrator. See [docs/desktop.md](docs/desktop.md).

## [0.1.0] - 2026-10-02

The first public release.

### Added

- **Projects** that bring every tool for a codebase into one place, with members and roles.
- **Board** with board, list and calendar views, custom statuses with icons and colours, priorities, assignees, due dates, filters and an archive.
- **Git**: branches, commits and changes from GitHub and GitLab, including self-hosted GitLab.
- **Database** browser for project databases: tables, keys and indexes, and queries.
- **API client** with collections and request history.
- **Docs** and **Drawings** (draw.io and Excalidraw) that live next to the work.
- **DevOps**: CI/CD pipelines for every merge request, with job logs in a terminal view.
- **SSH terminal** in the browser, with optionally saved, encrypted credentials, pinned host keys and a host allowlist.
- **Settings**: project settings, My account (profile, connections, SSH servers, sessions, preferences) and an Admin area (users, sign-in policy, audit log).
- **English and Filipino** interface.
- **Sign-in** with GitHub or GitLab tokens or OAuth. Tokens are encrypted at rest, and browser sessions are database-backed and HttpOnly.
- **Self-hosting** with Docker Compose (PostgreSQL and Redis included), or deploy to Vercel.
- Landing page with a self-playing product demo, and the Prompt mascot.

[Unreleased]: https://github.com/imnotseanwtf/devone/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/imnotseanwtf/devone/releases/tag/v1.1.1
[1.1.0]: https://github.com/imnotseanwtf/devone/releases/tag/v1.1.0
[0.1.0]: https://github.com/imnotseanwtf/devone/releases/tag/v0.1.0
