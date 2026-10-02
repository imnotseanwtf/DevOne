# Security policy

DevOne stores provider tokens, saved SSH credentials and database connection details, so we take security reports seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/imnotseanwtf/devone/security/advisories/new).

Include what you found, how to reproduce it, and the version or commit you tested. We aim to acknowledge reports within a few days and will keep you updated until it's fixed. With your permission, we'll credit you in the release notes.

## Supported versions

Security fixes go into the latest release and the `main` branch.

## Running DevOne safely

- Generate `DEVONE_ENCRYPTION_KEY` with `openssl rand -base64 32` and keep it secret. It encrypts every stored token and credential.
- Serve DevOne over HTTPS.
- Leave `DEVONE_ALLOW_REGISTRATION` off unless you want anyone with a valid token to sign in, or restrict sign-in with `DEVONE_GITHUB_ALLOWED_ORGS` / `DEVONE_GITLAB_ALLOWED_GROUPS`.
- Keep the SSH host allowlist as narrow as you can.
