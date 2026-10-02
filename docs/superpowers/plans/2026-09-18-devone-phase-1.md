# DevOne Phase 1 Implementation Plan

**Goal:** Deliver the project spec's complete Phase 1 MVP on the existing `main` branch.

**Architecture:** Use Prisma for DevOne's PostgreSQL data, native provider HTTP APIs for PAT validation, AES-256-GCM for stored credentials, and hashed opaque local sessions in HttpOnly cookies. Keep project reads and writes membership-scoped.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma/PostgreSQL, Zod, shadcn/ui, Bun, Docker Compose

**Spec:** `docs/superpowers/specs/2026-09-18-devone-phase-1-design.md`

## Task 1: Runtime and persistence foundation

**Files:** `package.json`, `env.example.txt`, `prisma/schema.prisma`, `prisma.config.ts`, `src/lib/db/prisma.ts`, `compose.yaml`

- [ ] Install Prisma, its PostgreSQL adapter/client requirements, and the PostgreSQL driver.
- [ ] Define `User`, `GitConnection`, `Session`, `Project`, and `ProjectMember` with the unique identities and cascading relationships in the design.
- [ ] Add a production-safe Prisma singleton and environment examples.
- [ ] Add health-checked PostgreSQL and Redis services plus the web service to Compose.
- [ ] Run Prisma format, validate, and generate.

## Task 2: Core security behavior through TDD

**Files:** `scripts/check-core.ts`, `src/lib/encryption/secrets.ts`, `src/lib/auth/session-token.ts`, `src/lib/git/provider.ts`, `src/lib/projects/slug.ts`, `package.json`

- [ ] Write failing assertions for authenticated encryption, wrong-key rejection, deterministic session hashing, safe GitLab base URLs, normalized GitHub/GitLab identities, and project slug generation.
- [ ] Run the core check and confirm it fails because the production modules do not exist.
- [ ] Implement the smallest standard-library helpers that satisfy those assertions.
- [ ] Run the core check and existing section check until both pass.

## Task 3: Provider login and local sessions

**Files:** `src/lib/git/github.ts`, `src/lib/git/gitlab.ts`, `src/lib/auth/session.ts`, `src/features/auth/actions.ts`, `src/features/auth/components/login-form.tsx`, `src/app/login/page.tsx`, `src/app/dashboard/layout.tsx`, `src/components/layout/header.tsx`

- [ ] Implement read-only provider identity validation over `fetch` with explicit status handling.
- [ ] Implement session creation, lookup, expiry cleanup, cookie issuance, and logout.
- [ ] Implement a server-validated login action and accessible provider/token form.
- [ ] Protect the dashboard layout with the database-backed session lookup and add logout to the header.
- [ ] Prove login modules with typecheck and focused core assertions.

## Task 4: Projects and live dashboard

**Files:** `src/features/projects/service.ts`, `src/features/projects/actions.ts`, `src/features/projects/components/project-form.tsx`, `src/app/dashboard/projects/page.tsx`, `src/app/dashboard/overview/page.tsx`, `src/app/dashboard/[section]/page.tsx`

- [ ] Add membership-scoped project listing and atomic project creation.
- [ ] Add server-side Zod validation and an accessible creation form with pending/error states.
- [ ] Replace the projects placeholder with the functional project list.
- [ ] Replace the dashboard's project placeholder count and empty copy with persisted values.
- [ ] Keep the shared dynamic placeholder route only for later phases.

## Task 5: Self-hosting and proof

**Files:** `README.md`, `docs/deployment.md`, generated Prisma migration

- [ ] Start PostgreSQL and Redis, create the first migration, and verify schema deployment.
- [ ] Update setup documentation with exact key generation, migration, and Compose commands.
- [ ] Run formatting, all checks, strict lint, typecheck, Prisma validation, production build, and a database smoke test.
- [ ] Commit the Phase 1 MVP on `main` only after every proof passes.
