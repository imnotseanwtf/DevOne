<p align="center">
  <img src="public/logo-animated.gif" width="88" height="88" alt="DevOne mascot, Prompt: a robot whose screen reads > 1_" />
</p>

<h1 align="center">DevOne</h1>

<p align="center">One workspace for everything developers need.</p>

<p align="center">
  <a href="https://github.com/imnotseanwtf/devone/actions/workflows/ci.yml"><img src="https://github.com/imnotseanwtf/devone/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://github.com/imnotseanwtf/devone/releases/latest"><img src="https://img.shields.io/github/v/release/imnotseanwtf/devone" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/imnotseanwtf/devone" alt="MIT License" /></a>
  <a href="https://github.com/imnotseanwtf/devone/pkgs/container/devone"><img src="https://img.shields.io/badge/docker-ghcr.io-2496ED?logo=docker&logoColor=white" alt="Docker image" /></a>
</p>

<p align="center">
  <a href="https://www.dev-one.site">Website</a> ·
  <a href="https://github.com/imnotseanwtf/devone/releases/latest">Desktop app</a> ·
  <a href="https://github.com/imnotseanwtf/devone">GitHub</a> ·
  <a href="docs/deployment.md">Docs</a> ·
  <a href="docs/promo/devone-promo-story.mp4">Demo video (MP4)</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fimnotseanwtf%2Fdevone&project-name=devone&repository-name=devone&env=DATABASE_URL,DEVONE_ENCRYPTION_KEY&envDescription=A%20PostgreSQL%20connection%20string%20and%20an%20encryption%20key%20from%20%60openssl%20rand%20-base64%2032%60&envLink=https%3A%2F%2Fgithub.com%2Fimnotseanwtf%2Fdevone%2Fblob%2Fmain%2Fdocs%2Fdeployment.md%23vercel"><img src="https://vercel.com/button" alt="Deploy with Vercel" /></a>
</p>

<p align="center">
  <a href="docs/promo/devone-promo-story.mp4"><img src="docs/promo/story-poster.png" width="800" alt="Too many projects? Watch DevOne's workspace walkthrough with music and introductions to every feature." /></a>
</p>

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

DevOne ships as ready-made Docker images, `ghcr.io/imnotseanwtf/devone` and
`ghcr.io/imnotseanwtf/devone-migrate`, with PostgreSQL and Redis in the Compose stack.

```bash
# 1. Get the code
git clone https://github.com/imnotseanwtf/devone
cd devone
# 2. Copy the example environment
cp env.example.txt .env
# 3. Set a database password and encryption key, and let the first sign-in become administrator
perl -pi -e "s/change-me/$(openssl rand -hex 16)/g; \
  s|^DEVONE_ENCRYPTION_KEY=.*|DEVONE_ENCRYPTION_KEY=$(openssl rand -base64 32)|; \
  s/^DEVONE_ALLOW_BOOTSTRAP=.*/DEVONE_ALLOW_BOOTSTRAP=true/" .env
# 4. Start the stack
docker compose pull
docker compose up -d
```

Step 3 fills the placeholders in `.env`: one random password for PostgreSQL and both database
URLs (hex, so it needs no URL-encoding), a new `DEVONE_ENCRYPTION_KEY` (back it up: losing it makes
stored tokens unrecoverable), and `DEVONE_ALLOW_BOOTSTRAP=true`. You can also edit `.env` by hand.

`docker compose pull` fetches the latest release images. To stay on a version, set
`DEVONE_VERSION=0.1.0` in `.env`; to build from source instead, run `docker compose up -d --build`.

Open [http://localhost:3000](http://localhost:3000) and sign in with a GitHub or GitLab token: the
first person to sign in becomes the administrator. Then set `DEVONE_ALLOW_BOOTSTRAP=false` in `.env`
and run `docker compose up -d` again. New-user registration is disabled by default.

Use TLS in production so secure session cookies cannot travel over plaintext connections.

Prefer a managed host? The **Deploy with Vercel** button above creates your own copy; you'll need a
PostgreSQL database (Neon works well) and an encryption key. See [docs/deployment.md](docs/deployment.md#vercel).

## Roadmap

DevOne is young, and the direction is open to discussion. Things we'd like to do next:

- Published Docker images for every release
- A public demo instance
- More interface languages beyond English and Filipino
- Better mobile layouts across the workspace
- Notifications for mentions, assignments and failed pipelines

Have an idea or want to pick one up? Start a thread in [Discussions](https://github.com/imnotseanwtf/devone/discussions) or look for issues labelled [`good first issue`](https://github.com/imnotseanwtf/devone/labels/good%20first%20issue).

## Contributing

Contributions are welcome! Fork the repository, make your change on a branch in your fork, and open a pull request against `main`. [CONTRIBUTING.md](CONTRIBUTING.md) has the details. Questions are best asked in [Discussions](https://github.com/imnotseanwtf/devone/discussions).

Found a security problem? Please report it privately; see [SECURITY.md](SECURITY.md). Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## License

DevOne is released under the [MIT License](LICENSE). It began from the MIT-licensed [Next Shadcn Dashboard Starter](https://github.com/Kiranism/next-shadcn-dashboard-starter).
