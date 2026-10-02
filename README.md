<p align="center">
  <img src="public/logo-animated.gif" width="88" height="88" alt="DevOne mascot, Prompt: a robot whose screen reads > 1_" />
</p>

<h1 align="center">DevOne</h1>

<p align="center">One workspace for everything developers need.</p>

<p align="center"><a href="docs/demo.mp4">Watch the demo</a> · every tool in under a minute</p>

DevOne is a self-hosted developer workspace that connects project work, Git activity, databases, APIs, documentation, and deployments in one project context.

## Current MVP

- Next.js 16 and React 19
- TypeScript and Tailwind CSS 4
- shadcn/ui dashboard shell
- GitHub and GitLab personal access token login
- Encrypted provider credentials and database-backed HttpOnly sessions
- PostgreSQL-backed projects and live dashboard counts
- Login throttling and self-hosted GitLab host allowlisting
- Theme support and production Dockerfiles
- Docker Compose with PostgreSQL and Redis

## Tech stack

See [docs/tech-stack.md](docs/tech-stack.md) for every framework, library and service DevOne uses.

## Development

```bash
bun install
cp env.example.txt .env
# Set both database URLs and POSTGRES_PASSWORD, then generate DEVONE_ENCRYPTION_KEY with:
# openssl rand -base64 32
docker compose up -d postgres redis
bun run db:deploy
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
bun run test
bun run test:db
bun run lint:strict
bun run typecheck
bun run build
```

## Self-hosting

Configure `.env`, then start the complete stack:

```bash
cp env.example.txt .env
openssl rand -base64 32
# Paste the generated value into DEVONE_ENCRYPTION_KEY, choose a PostgreSQL password,
# URL-encode it in both database URLs, then start DevOne.
docker compose up -d
```

For the first administrator only, set `DEVONE_ALLOW_BOOTSTRAP=true`, sign in once, then set it
back to `false` and restart the web service. New-user registration is disabled by default.

Open [http://localhost:3000](http://localhost:3000). Use TLS in production so secure session
cookies cannot travel over plaintext connections.

The project is based on the MIT-licensed [Next Shadcn Dashboard Starter](https://github.com/Kiranism/next-shadcn-dashboard-starter).
