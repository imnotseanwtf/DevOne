# DevOne AI Gateway Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the independent protocol and OAuth tasks; integrate and verify on the requested branch.

**Goal:** Extend the existing AI router into the gateway described by the supplied 9Router implementation plan: provider registry, encrypted connections, OAuth lifecycle, native protocol translation, streaming, and account fallback.

**Architecture:** Keep the Next.js routes and existing Prisma/PostgreSQL database. Separate provider definitions from encrypted account connections. A request resolves provider/model, selects accounts, refreshes credentials, translates to the target format, executes, translates the response, and falls back only for eligible failures before output begins.

**Tech Stack:** Next.js 16, TypeScript, Prisma/PostgreSQL, Web Streams, existing shadcn/TanStack Form components; no new runtime dependency.

**Spec:** User-supplied `/home/imnotseanwtf/Downloads/9router-style-ai-gateway-implementation-plan.md`, especially sections 3–30 and 33/40. Reference: https://github.com/decolua/9router.

## Constraints and scope

- Work on `claude/optimistic-johnson-gd50j7`; merge current `origin/main` first (done: `8febf94`).
- Adapt SQLite examples to existing PostgreSQL rather than introduce a second state store.
- Preserve existing provider records, gateway keys, combos, and endpoint `/api/ai/v1`.
- Start with OpenAI-compatible, Anthropic API-key, Responses, local, and configurable PKCE OAuth transports. Provider-specific configuration includes Claude/Codex but does not impersonate first-party clients.
- OAuth client IDs/secrets and approved endpoints are installation configuration. Do not hardcode another application's OAuth identity.
- Keep tool calls/results, images, finish reasons and usage in supported translations; reject unsupported content rather than silently drop it.
- Do not port all 129 providers or unrelated speech/image/search services. Section 40 requires an incremental rollout.
- Admin onboarding must be usable through the existing AI settings page; use shared fields/forms for new controls.
- Gateway authentication and provider authentication are separate; no credential values leave the server or enter logs.
- Existing `defaultModel`, compression controls, and `savedChars` fields become functional.

## Review focus

1. OAuth state is user-bound, expiring and single-use; callbacks cannot select another account.
2. Two requests cannot rotate the same refresh token; reload after acquiring the lock and persist atomically.
3. An upstream that sends headers then stalls must time out; cancellation must stop upstream.
4. SSE tool arguments may arrive across arbitrary byte/event boundaries; HTTP 200 error events must not count as healthy completions.
5. Legacy provider keys and configs still route after migration; custom URLs cannot reach metadata services or redirect secrets.

## Task 1 — Registry, credentials and OAuth primitives

Files: `src/lib/ai-router/types.ts`, `registry.ts`, `oauth.ts`, `credentials.ts`; `scripts/check-ai-oauth.ts`.

Interfaces: `ProviderFormat = 'openai' | 'claude' | 'openai-responses'`; `ProviderCredential` contains id, authType, apiKey/accessToken/refreshToken/idToken, expiresAt, lastRefreshAt and providerSpecificData. Registry definitions contain alias, target format, auth headers, upstream path, OAuth config, models and refresh lead.

- [x] Write checks for PKCE S256, authorization URLs, token normalization, expiry, refresh rotation and concurrent refresh.
- [x] Observe checks fail before implementing.
- [x] Implement registry-driven authentication, generic PKCE exchange/refresh, and a credential manager with per-account lock and repository reload/persistence.
- [x] Run focused checks and report interfaces to integration task.

## Task 2 — Protocol pipeline and streaming

Files: `src/lib/ai-router/translation.ts`, `streaming.ts`, `executors.ts`, `forward.ts`, `routing.ts`; `scripts/check-ai-protocols.ts`.

Interfaces: existing `forwardChatCompletion(ForwardOptions)` stays compatible; add credential/refresh callbacks and format configuration to targets. Translate between Chat, Claude and Responses. Outbound requests use a registry-derived URL/auth header.

- [x] Write checks for system text, tool calls/results, images, JSON responses, split SSE frames, usage, finish reasons, upstream error events, timeouts, cancellation and fallback.
- [x] Observe failing checks before implementation.
- [x] Implement one-account execution and protocol translation, keeping fallback in forwarding orchestration.
- [x] Make cooldown filtering and per-request exclusions effective; preserve existing tests.
- [x] Run focused checks and existing router checks.

## Task 3 — Persistence and endpoint integration

Files: `prisma/schema.prisma`, additive migration, `src/features/ai-router/api/{types,service,queries}.ts`, existing `service.ts`, `schema.ts`, `actions.ts`, `request.ts`; `src/app/api/ai/oauth/[providerId]/{authorize,callback}/route.ts`.

- [x] Add provider definition fields, encrypted account connections, expiring OAuth sessions and per-account cooldown/model restrictions.
- [x] Backfill each existing provider key into its first connection; support legacy reads during migration.
- [x] Wire repository to OAuth credential manager and routing.
- [x] Add admin-bound onboarding, callback state validation/consumption, encrypted credential persistence, account activation/deletion and audit events.
- [x] Apply request body limits, controlled custom/local URL access, redirection restrictions, gateway authentication and usage recording.
- [x] Wire default-model fallback and bounded tool-output compression without changing tool IDs/structure.
- [x] Generate Prisma client; run schema validation and focused integration checks.

## Task 4 — Admin controls, docs and final verification

Files: AI provider/settings/connection components, admin page, English/Filipino messages, `docs/ai-router.md`, `env.example.txt`, `package.json`.

- [x] Extend provider onboarding with protocol/auth mode and OAuth connect action; show account state without exposing secrets.
- [x] Add router settings controls and show saved-character usage.
- [x] Document configuration, supported formats, migration procedure, and provider rollout limits.
- [x] Run full tests, typecheck, lint, formatting checks and production build where environment permits.
- [x] Review the whole change, fix material findings, and report any external-provider validation still requiring real credentials.

## Execution record

- `8febf94`: updated requested branch from origin/main; kept Filipino AI tab translation.
- Adaptation: use PostgreSQL and installation-configured OAuth identities, following the plan's existing-stack and provider-supported-flow guidance.

- Implemented provider registry, configurable PKCE OAuth, encrypted multi-account persistence, refresh rotation and locking, Chat/Messages/Responses translation and streaming, account fallback, admin controls, default-model routing and native tool-output compression.
- Final review fixes: unified provider name/alias namespace under a transaction lock; pinned validated DNS addresses for outbound connections; bound OAuth accounts to configuration/upstream; preserved native request options; rejected unsupported Claude reasoning streams; kept Responses terminal items in streamed index order.
- Final checks (2026-10-10): full `bun run test`, `tsc --noEmit`, Prisma validation and production build passed. Lint passed with 14 existing warnings. Changed source files passed formatting; the whole-repository formatter reports two unchanged promo JSON files (`docs/promo/recordings/project.json`, `docs/promo/story-metadata.json`). `git diff --check` passed.
- All 43 migrations were executed in a temporary PostgreSQL-compatible engine. Verified legacy key/cooldown backfill, no-auth records, OAuth state uniqueness, cascades and usage foreign-key retention. No live database was modified.
- Independent final review found no outstanding material issues after regression checks. Real-provider/OAuth interoperability still needs installation-specific client configuration and credentials. Device-code and additional provider/modality rollouts remain future phases as specified above.
