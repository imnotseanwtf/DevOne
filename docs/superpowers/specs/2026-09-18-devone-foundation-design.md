# DevOne Foundation Design

## Goal

Create a runnable DevOne foundation from the specified dashboard starter while removing Clerk and demo product baggage.

## Scope

- Copy the current `Kiranism/next-shadcn-dashboard-starter` working tree into `dev-one` without its Git history.
- Install dependencies with Bun and run the starter's supported Clerk cleanup.
- Keep the dashboard layout, theme system, reusable UI, forms, tables, and Docker support.
- Replace starter branding and navigation with DevOne and its primary product areas.
- Provide a minimal dashboard landing page using static placeholder project data only.
- Verify formatting/linting, TypeScript, and a production build using the starter's existing scripts.

## Architecture

This slice preserves the starter's Next.js App Router and feature-based structure. It adds no database, authentication replacement, queue, or provider abstraction yet; those belong to later independently testable slices. The initial dashboard is a server-rendered shell with no secret handling or external calls.

## Data Flow

The browser requests the dashboard, Next.js renders the static DevOne overview, and sidebar links expose only placeholder destinations that exist in this slice. No user data is persisted or fetched.

## Error Handling and Security

Clerk credentials and integrations are removed through the starter's cleanup command. No PAT input, token storage, database credentials, or production actions are introduced until their secure server-side flows are implemented.

## Verification

- Dependency installation succeeds.
- The starter's cleanup completes without leaving Clerk imports or dependencies.
- Existing lint/typecheck scripts pass.
- The production build succeeds.
- The DevOne dashboard route renders from the built application.

## Deferred

PostgreSQL, Prisma, Docker Compose services, GitHub/GitLab PAT authentication, sessions, and CRUD projects are deferred to later slices because each introduces separate security and persistence invariants.
