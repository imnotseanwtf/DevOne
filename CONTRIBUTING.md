# Contributing to DevOne

Thanks for helping! This guide covers how to set up DevOne, how branches work, and what a good pull request looks like.

## Branches

All work goes into **`main`**: open your pull requests against it. Releases are tagged from `main`.

Only maintainers can push to `main`. Everyone else works in their own fork and sends a pull request: you don't need permission or a branch from us to start.

For anything bigger than a small fix, please open an issue or a [Discussion](https://github.com/imnotseanwtf/devone/discussions) first, so we can agree on the approach before you spend time on it.

## Setting up

You'll need [Bun](https://bun.sh) 1.3+, Docker, and Git.

First, **fork** the repository on GitHub (the Fork button, top right), then clone your fork:

```bash
git clone https://github.com/<your-username>/devone
cd devone
git remote add upstream https://github.com/imnotseanwtf/devone
bun install
cp env.example.txt .env
# Generate DEVONE_ENCRYPTION_KEY with: openssl rand -base64 32
docker compose up -d postgres redis
bun run db:deploy
bun run dev
```

Open http://localhost:3000.

## Making a change

1. Get the latest `main` and create a branch from it:
   ```bash
   git fetch upstream
   git checkout -b fix/board-drag upstream/main
   ```
2. Make your change. Read [AGENTS.md](AGENTS.md) for the project's structure and conventions, and [docs/forms.md](docs/forms.md) if you're building a form.
3. Run the checks:
   ```bash
   bun run typecheck
   bun run lint
   bun run format:check   # bun run format fixes formatting
   bun run test
   bun run test:db        # needs the database from docker compose
   ```
4. Push the branch to your fork (`git push -u origin fix/board-drag`) and open a pull request against `imnotseanwtf/devone`'s `main` branch. Fill in the template; CI runs automatically, and a maintainer will review it.

## Conventions

- **Formatting:** single quotes, no trailing commas, 2-space indent. `bun run format` applies it.
- **Icons:** import from `@/components/icons` only.
- **Data:** TanStack Query for fetching, one `api/` folder per feature (`types.ts` → `service.ts` → `queries.ts`).
- **Text:** anything people read goes in `src/i18n/messages/en.ts` and `fil.ts`.
- **Database:** schema changes need a Prisma migration (`bun run db:migrate`).
- **Commits:** short, in the imperative ("Add calendar view"), one logical change each.

## Reporting bugs and ideas

Use the issue forms. For security problems, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE), and to follow our [code of conduct](CODE_OF_CONDUCT.md).
