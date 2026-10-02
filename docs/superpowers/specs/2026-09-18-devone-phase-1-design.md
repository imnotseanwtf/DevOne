# DevOne Phase 1 Design

## Goal

Turn the dashboard shell into the runnable self-hosted MVP from the project spec: PostgreSQL-backed users and projects, GitHub/GitLab PAT login, secure local sessions, and Docker Compose deployment.

## Architecture

- Next.js App Router owns pages, route handlers, and server actions.
- Prisma owns only DevOne's PostgreSQL schema.
- Provider adapters validate PATs and normalize the remote identity; PATs are encrypted with AES-256-GCM before persistence.
- The browser receives a random session token in an HttpOnly cookie. PostgreSQL stores only its SHA-256 hash.
- Projects are accessed only through membership-scoped queries.
- Docker Compose runs the web application, PostgreSQL, and Redis. Redis is provisioned for later queue-backed slices but is not used by Phase 1.

## Data Model

- `User`: stable `(provider, providerUserId)` identity plus profile and role.
- `GitConnection`: one encrypted provider credential per user/provider/base URL.
- `Session`: hashed opaque token, expiry, and owning user.
- `Project`: name, unique slug, description, creator, and timestamps.
- `ProjectMember`: project/user membership and role with a unique pair constraint.

## Authentication Flow

1. `/login` accepts provider, PAT, and an optional GitLab base URL.
2. The server validates the URL and token with the selected provider.
3. A transaction upserts the user and encrypted connection.
4. A random session token is hashed for storage and sent only through a secure HttpOnly cookie.
5. The dashboard layout resolves the session from PostgreSQL; invalid or expired sessions redirect to `/login`.
6. Logout deletes the server-side session before clearing the cookie.

## Project Flow

- `/dashboard/projects` lists only projects joined through `ProjectMember`.
- Creation validates the request, derives a deterministic available slug, and creates the project plus owner membership atomically.
- The dashboard computes real project counts; later features replace the remaining zero-value metrics.

## Error Handling and Security

- Reject unsupported providers, malformed/self-hosted GitLab URLs, empty/oversized tokens, and invalid project payloads at the server boundary.
- Never log, serialize, or return PATs, encrypted PATs, session tokens, or encryption keys.
- Provider failures return a generic login error while preserving useful server status classes.
- Cookies use `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production.
- Production startup requires an explicit 32-byte encryption key and database URL.

## Verification

- Dependency-free checks prove encryption round trips, session hashing, provider URL normalization, and project slug behavior.
- Prisma validates and generates successfully.
- Strict lint, TypeScript, formatting, and production build pass.
- A PostgreSQL-backed smoke test proves login-independent database CRUD when Docker is available.

## Deferred

Provider repository synchronization, webhooks, database adapters, ERD, issue tracking, API tools, docs, and DevOps belong to subsequent spec phases after this security and ownership boundary is stable.
