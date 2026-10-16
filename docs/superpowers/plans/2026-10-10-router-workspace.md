# Router workspace implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the gateway into a standalone Router screen reached from the user menu, with 9Router-style provider cards, multiple accounts per provider and Endpoint & Keys.

**Architecture:** Reuse the encrypted gateway, account controls, provider forms and personal keys. Add `/router` with the existing SettingsTabs and a header without a sidebar. Preserve administrator permissions for installation-wide credentials; all signed-in users can manage their personal keys.

**Tech Stack:** Existing Next.js, React Query, TanStack Form, shadcn and PostgreSQL; no new dependencies.

**Spec:** User's two screenshots and request on 2026-10-10. Providers use compact grouped cards with search and connection status; provider selection opens account controls. Endpoint & Keys includes copyable protocol endpoints, personal key lifecycle, models and examples. Existing combos, usage, defaults and token-saving settings remain accessible through tabs.

## Global constraints

- Use the current branch and preserve existing user data.
- No router sidebar, no AI router tab inside Admin.
- Use PageContainer, SettingsTabs, centralized Icons and existing forms/services.
- OAuth callbacks return to Router; credentials remain server-side and encrypted.
- Display supported providers only. No simulated quota, connectivity or tunnel status.

## Review focus

- Members must not receive shared credential/account data or mutation permission.
- Account counts include disabled accounts; availability excludes missing credentials, expired unrefreshable tokens and cooldowns.
- Adding another account must retain the other accounts and provider definition.
- OAuth cancellation and old bookmarks must return to the new screen.
- Long endpoint/model names must work on mobile; snippets must quote model IDs correctly.

### Task 1: Router navigation and provider workspace

**Files:** `src/app/router/{layout,page}.tsx`, user menu, admin/account pages, OAuth callback, gateway actions/panel, new provider catalog/model helper and translations.

**Interfaces:** AiGatewayPanel consumes userId, view ('providers' or 'settings') and optional providerId/oauthResult. Existing account controls receive only the selected provider. Catalog uses AiProviderSummary/AiConnectionSummary.

- [x] Write and run a failing real-browser check for Router menu, tabs, no sidebar and multiple accounts under one provider; write availability/count checks.
- [x] Add route and menu; redirect old Admin/Account AI tabs; update callback/revalidation.
- [x] Add grouped preset/configured cards, search/filter, selected-provider controls and direct OAuth additions.
- [x] Run the browser and helper checks, typecheck and gateway suite.

### Task 2: Endpoint & Keys and validation

**Files:** AI key settings, Router page, UI check script, docs.

**Interfaces:** Existing AiKeysSettings receives userId and uses gatewayEndpointQueryOptions for session-owned keys, endpoint and public model IDs; key creation returns the secret once.

- [x] Extend browser checks for endpoint copying, key creation/removal and member access boundaries.
- [x] Add endpoint-first layout, protocol examples, copyable model IDs and shared form anatomy.
- [x] Verify all tabs, OAuth cancellation, desktop/mobile layouts, full tests, typecheck, lint and formatting.
- [x] Obtain an independent review, address material findings, commit locally and leave the local server running.

## Execution and verification

- Implemented on `claude/optimistic-johnson-gd50j7`; reused existing encrypted credential/account services and sidebar-free screen tabs.
- Added session-authenticated `getGatewayEndpoint` plus an endpoint query key. Combos join the administrator gateway query. All gateway mutations invalidate their query keys, including inactive tabs, to keep Back/Forward current.
- Browser regression caught an account-update/navigation race caused by overlapping RSC refreshes; removed those refreshes after query invalidation became responsible for every changed tab.
- Independent review found two availability mismatches (unconfigured OAuth refresh and legacy provider-wide cooldown); both checks failed before their fixes and pass now.
- Production browser regression reproduced stale model lists after Back; endpoint query caching fixed it. Added combo rename/Back regression, creation and removal checks.
- Full project tests, TypeScript, production build, scoped lint (zero warnings), scoped formatting and desktop/mobile browser checks pass. Whole-repository lint retains 14 pre-existing warnings.
- Browser checks use their own temporary users/providers/accounts/combos/keys and remove them. Claude consent is intercepted; no real provider token exchange is claimed by the automated check.
