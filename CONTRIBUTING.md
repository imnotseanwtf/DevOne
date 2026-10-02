# Contributing to DevOne

Thanks for helping! This guide covers how to set up DevOne, how branches work, and what a good pull request looks like.

## Branches

| Branch | What it's for |
|---|---|
| `dev` | Day-to-day development. **Open your pull requests against `dev`.** |
| `staging` | Release candidates. `dev` is merged here to test a release before it ships. |
| `main` | Released, production-ready code. Only `staging` is merged here. |

Changes flow one way: **feature branch → `dev` → `staging` → `main`**. Fixes that can't wait (hotfixes) branch from `main` and are merged back into `staging` and `dev` too.

## Setting up

You'll need [Bun](https://bun.sh) 1.3+, Docker, and Git.

```bash
git clone https://github.com/imnotseanwtf/devone
cd devone
git checkout dev
bun install
cp env.example.txt .env
# Generate DEVONE_ENCRYPTION_KEY with: openssl rand -base64 32
docker compose up -d postgres redis
bun run db:deploy
bun run dev
```

Open http://localhost:3000.

## Making a change

1. Create a branch from `dev`: `git checkout -b fix/board-drag dev`
2. Make your change. Read [AGENTS.md](AGENTS.md) for the project's structure and conventions, and [docs/forms.md](docs/forms.md) if you're building a form.
3. Run the checks:
   ```bash
   bun run typecheck
   bun run lint
   bun run format:check   # bun run format fixes formatting
   bun run test
   bun run test:db        # needs the database from docker compose
   ```
4. Open a pull request against `dev` and fill in the template.

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
