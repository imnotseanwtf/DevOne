# Deployment

DevOne deploys anywhere Docker runs. The included Compose stack provides the application,
PostgreSQL, Redis, and a one-shot migration service.

## Required environment

Copy `env.example.txt` to `.env` and set at least:

```dotenv
POSTGRES_PASSWORD=a-long-random-password
DATABASE_URL=postgresql://devone:a-long-random-password@localhost:5432/devone
DEVONE_DOCKER_DATABASE_URL=postgresql://devone:a-long-random-password@postgres:5432/devone
DEVONE_ENCRYPTION_KEY=base64-encoded-32-byte-key
```

Generate the encryption key with `openssl rand -base64 32`. Losing this key makes stored provider
tokens unrecoverable. Do not store it in PostgreSQL. URL-encode reserved characters in the
password portion of both database URLs; keep `POSTGRES_PASSWORD` as the unencoded value.

Bootstrap the first administrator explicitly:

1. Set `DEVONE_ALLOW_BOOTSTRAP=true`.
2. Start DevOne and complete one provider login.
3. Set `DEVONE_ALLOW_BOOTSTRAP=false` and restart the web service.

Bootstrap and new-user registration both default to disabled, so an internet visitor cannot claim
a fresh installation.

Optional controls:

- `DEVONE_AUTH_PROVIDERS`: comma-separated `github,gitlab` values.
- `DEVONE_ALLOW_BOOTSTRAP`: temporarily permits the first login to become administrator.
- `DEVONE_ALLOW_REGISTRATION`: permits additional valid provider users; defaults to `false`.
- `DEVONE_TRUST_PROXY`: set `true` only when the reverse proxy overwrites `X-Forwarded-For`.
- `DEVONE_POSTGRES_PORT` and `DEVONE_REDIS_PORT`: localhost-bound development ports.

## Vercel

The **Deploy with Vercel** button in the README creates your own copy. It asks for
`DATABASE_URL` (any PostgreSQL; with Neon, also set `DATABASE_URL_UNPOOLED`, see below) and
`DEVONE_ENCRYPTION_KEY` (`openssl rand -base64 32`). Then set `DEVONE_ALLOW_BOOTSTRAP=true` to
sign in as the first administrator, and turn it off again afterwards.

Only the `main` branch deploys. `vercel.json` turns off deployments for `dev`, `staging`,
Dependabot's `dependabot/*` branches and `claude/*`, because every Vercel build runs
`prisma migrate deploy` and would otherwise apply unreleased migrations to whatever database
that environment points at. To deploy `staging` or `dev` later, give that branch its own
`DATABASE_URL` and `DEVONE_ENCRYPTION_KEY` in Vercel first, then remove it from
`git.deploymentEnabled`.

## Landing page

Signed-out visitors to `/` go straight to the sign-in page. The marketing landing page (with the
product tour) is only for DevOne's own website: set `DEVONE_LANDING_PAGE=true` to show it. A
public demo (below) shows it automatically.

## Public demo

Set `DEVONE_DEMO_MODE=true` to run a public demo that anyone can try without signing up. Run it
as a **separate deployment with its own database and encryption key**, never on the instance your
team uses.

In demo mode:

- The sign-in page shows **Start the demo** instead of the sign-in form. Each visitor gets a
  throwaway account with their own sample project ("Acme web app": tasks, docs and saved API
  requests), so nobody can change what another visitor sees.
- Demo accounts expire after 24 hours. Expired accounts and everything in them are deleted
  automatically whenever someone starts a new demo.
- Nothing connects to other machines. Git, pipelines, databases and the terminal run against
  built-in stand-ins instead: a sample repository with merge requests and CI runs, a read-only
  sample database (customers, products, orders) that answers simple SELECT queries, and a
  simulated SSH terminal that runs in the browser. Sending API requests, importing from URLs, and
  signing in with or connecting GitHub and GitLab accounts are refused. This stops anyone from
  using the demo to reach or attack other systems, and means no one enters real credentials.
- Each sample project also comes with resources (environments, release tags, a Docker image), an
  Excalidraw sketch and a draw.io diagram.
- Starting demos is rate-limited per visitor (set `DEVONE_TRUST_PROXY=true` behind a proxy such as
  Vercel's so the visitor's address is known) and capped at 300 an hour overall.

## Pooled databases (Neon, PgBouncer)

`prisma migrate deploy` takes a session-level advisory lock, which a pooled connection can't hold
reliably; the build then fails with `P1002 … Timed out trying to acquire a postgres advisory lock`.
When `DATABASE_URL` is pooled (Neon's host ends in `-pooler`), also set `DATABASE_URL_UNPOOLED` (or
`DIRECT_URL`) to the direct connection string. Migrations use it; the app keeps the pooled one.
Neon's Vercel integration sets `DATABASE_URL_UNPOOLED` for you.

## Sign in with GitHub or GitLab (optional)

The login page always accepts a personal access token. To also show **Continue with GitHub**
and **Continue with GitLab**, register an OAuth app with each provider and set:

```dotenv
DEVONE_APP_URL=https://devone.example.com
DEVONE_GITHUB_CLIENT_ID=
DEVONE_GITHUB_CLIENT_SECRET=
DEVONE_GITLAB_CLIENT_ID=
DEVONE_GITLAB_CLIENT_SECRET=
DEVONE_GITLAB_OAUTH_URL=https://gitlab.com
```

- `DEVONE_APP_URL` is the public address providers send users back to. On Vercel it falls back
  to the production domain.
- **GitHub:** Settings → Developer settings → OAuth Apps → New OAuth App. Use
  `https://<devone>/api/auth/github/callback` as the callback URL. DevOne asks for the
  `repo read:org read:user` scopes.
- **GitLab:** User or group Settings → Applications (or Admin → Applications on a self-hosted
  instance). Use `https://<devone>/api/auth/gitlab/callback` as the redirect URI, tick
  *Confidential*, and select the `api` and `read_user` scopes. Set `DEVONE_GITLAB_OAUTH_URL` to
  your instance for self-hosted GitLab; it must also pass `DEVONE_GITLAB_ALLOWED_HOSTS`.

A button appears only when its client ID, secret and `DEVONE_APP_URL` are all set. OAuth sign-ins
follow the same organization, bootstrap and registration rules as tokens, and the issued token is
stored encrypted like a personal access token. GitLab OAuth tokens expire after two hours, so
DevOne keeps the refresh token and renews them as needed.

## Drawings

Drawings come in two kinds: Excalidraw sketches and draw.io diagrams.

Excalidraw sketches run in the bundled editor and are saved in DevOne's database, one row per shape
(`DrawingElement`). When creating one you choose:

- **Live sketch**: every open copy syncs through DevOne about once a second (faster while someone
  else is in it), merging with Excalidraw's own rule (higher version wins). Everyone sees each
  other's shapes, named cursors and "who's here" avatars. No extra server is needed: sync runs as
  ordinary server actions against Postgres, so it works on Vercel.
- **Local sketch**: saved the same way, but it doesn't pull others' changes or share cursors while
  open. The **Live** switch on a sketch changes this at any time.

Sketches saved before live sync move into the shape table the first time they are opened.

Sketches created while live sketches were embedded excalidraw.com sessions (they have a `liveRoom`)
still open that session. **Import into DevOne** copies one into the bundled editor. **New drawing →
Import from Excalidraw…** does the same for any live-session link (`#room=`) or shareable link
(`#json=`). The server downloads the drawing from `firestore.googleapis.com` (live sessions),
`json.excalidraw.com` (shareable links) and `firebasestorage.googleapis.com` (images), and decrypts
it with the key in the link. Those hosts must be reachable from the server.
`NEXT_PUBLIC_EXCALIDRAW_URL` only affects those older embedded sessions.

draw.io
runs in an iframe from `https://embed.diagrams.net` in embed mode: diagrams are exchanged with the
page over `postMessage` and saved in DevOne's database, not on diagrams.net. To serve the editor
yourself (for example on a network without internet access), host [jgraph/drawio](https://github.com/jgraph/drawio)
and set `NEXT_PUBLIC_DRAWIO_URL` to its address before building.

## DevOps: pipelines and SSH terminal

**Pipelines** read the linked repository's CI through the same token as the rest of the Git
features: open pull/merge requests with their pipelines, each pipeline's jobs, and each job's log
(shown in a terminal view with its colours). GitHub publishes a job's log when the job finishes;
GitLab streams it while the job runs. Only the last 1 MB of a log is shown.

**Terminal** opens an SSH shell to any server from **DevOps → Terminal**. It asks for the host,
port, username and a password or private key; **Save these credentials** stores them encrypted
with `DEVONE_ENCRYPTION_KEY`, visible only to the person who saved them, so the server connects
in one click next time. A saved server's host key is pinned on the first connection, and a
different key later refuses to connect.

The SSH connection runs inside the DevOne server process and reaches the browser over
Server-Sent Events, so the terminal needs a **long-running Node.js server**: Docker Compose,
`next start`, or one instance behind a load balancer with sticky sessions. On serverless hosting
(Vercel) requests can land on different instances and a function is stopped after its time limit,
so terminals disconnect; the pipeline views work everywhere. DevOne's server must be able to
reach the SSH hosts (port 22 or the one entered). Each person can have 5 terminals open; an idle
one (no input or output for an hour) closes, as does one whose browser tab has been gone for
30 seconds.

## Settings, My account and Admin

- **Project settings** (sidebar → Settings): details and task-key prefix, members and roles,
  linked repositories and their production branch, DevOps controls (who may use the terminal,
  allowed SSH hosts, branches hidden from the pipeline lists) and, for owners, the project's
  activity log. Only owners can change anything.
- **My account** (click your username): profile, connected GitHub/GitLab accounts (replace a token,
  connect another account, remove one), saved SSH servers across projects (rename, reset the
  pinned host key, remove), sessions (sign out other devices) and preferences: language, theme,
  terminal font size and start page.
- **Admin** (administrators only): change roles, disable or enable people (disabling signs them
  out everywhere and refuses their sign-in), the AI router's providers, combos and usage, a
  read-only view of the sign-in environment variables, and the audit log of the whole
  installation.
- **AI router**: one OpenAI-compatible endpoint (`/api/ai/v1`) that falls back across the model
  providers an administrator sets up; people create their own keys under My account → AI keys.
  `DEVONE_AI_RATE_LIMIT` caps requests per person per minute (default 60, `0` for no limit). See
  [ai-router.md](./ai-router.md).

The browser and address of each sign-in are recorded for the Sessions list; the address only
when `DEVONE_TRUST_PROXY=true`.

## Languages

DevOne is available in English and Filipino. Each person picks a language under My account →
Preferences; before that, the browser's language is used. The sidebar, header, DevOps, Settings,
My account and Admin pages are translated; other pages are still in English.

Messages live in `src/i18n/messages/`. To add a language, copy `fil.ts`, translate it (the
typecheck fails until every key is present, and `bun run test` checks every `{placeholder}` is
kept), then register it in `src/i18n/messages/index.ts` and `LOCALES` in `src/i18n/config.ts`.

## Docker Compose

Start the stack after configuring `.env`:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Every release publishes two images: `ghcr.io/imnotseanwtf/devone` (the app) and
`ghcr.io/imnotseanwtf/devone-migrate` (a slim image that applies database migrations), for
`linux/amd64` and `linux/arm64`. Compose uses the `latest` tag; set `DEVONE_VERSION` in `.env` to
pin a release (e.g. `0.1.0`). To upgrade, pull again and restart. To build the images from
source instead, run `docker compose up -d --build`.

Compose waits for PostgreSQL, applies committed Prisma migrations, then starts DevOne at
`http://localhost:3000`. Put a TLS reverse proxy in front of the application for production.

Back up the `devone-postgres` volume and the installation encryption key separately. Restore both
to recover encrypted Git connections.

## Manual deployment

With an external PostgreSQL service, run migrations before starting the application:

```bash
bun install --frozen-lockfile
bun run db:deploy
bun run build
bun run start
```

Redis is provisioned now for the later queue worker but is not required by the Phase 1 web process.
