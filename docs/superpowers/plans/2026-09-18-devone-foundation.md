# DevOne Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a runnable, branded DevOne dashboard foundation from the specified starter kit.

**Architecture:** Preserve the starter's Next.js App Router, layout, UI primitives, theme system, and Dockerfiles. Remove Clerk and demo features before replacing the root route, navigation, overview, and placeholder section routes with server-rendered DevOne pages.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.7, Tailwind CSS 4, shadcn/ui, Bun

**Spec:** `docs/superpowers/specs/2026-09-18-devone-foundation-design.md`

## Global Constraints

- Import the starter working tree without its `.git` directory or commit history.
- Keep the existing `dev-one` repository and design commit.
- Remove Clerk using the starter's supported cleanup command.
- Add no database, authentication replacement, queue, or provider abstraction in this slice.
- Use server components unless browser state requires a client component.
- Import icons only through `src/components/icons.tsx`.

---

### Task 1: Import and strip the starter

**Files:**
- Import: starter working tree into repository root
- Preserve: `docs/superpowers/specs/2026-09-18-devone-foundation-design.md`
- Modify: `package.json`
- Delete through supported cleanup: Clerk, Kanban, Chat, AI Chat, Notifications, and example pages
- Delete: `src/app/dashboard/product/`, `src/app/dashboard/users/`, `src/features/products/`, `src/features/users/`

**Interfaces:**
- Consumes: the public starter repository at `Kiranism/next-shadcn-dashboard-starter`
- Produces: an installable Next.js dashboard without authentication or demo application features

- [ ] **Step 1: Copy the starter without its Git metadata**

```bash
git clone --depth 1 https://github.com/Kiranism/next-shadcn-dashboard-starter.git /tmp/devone-starter
rsync -a --exclude=.git --exclude=docs/superpowers/ /tmp/devone-starter/ ./
```

- [ ] **Step 2: Install the unmodified starter dependencies**

Run: `bun install`

Expected: exit code 0 and a populated Bun install cache/node_modules.

- [ ] **Step 3: Run the starter's cleanup engine**

Run: `bun run cleanup clerk kanban chat ai-chat notifications examples`

Expected: the command reports each selected feature removed and removes `@clerk/nextjs` from `package.json`.

- [ ] **Step 4: Remove the remaining product and user demos**

```bash
git rm -r src/app/dashboard/product src/app/dashboard/users src/features/products src/features/users
```

- [ ] **Step 5: Identify and remove imports orphaned by the demo deletion**

Run: `rg -n "features/(products|users)|mock-api|/dashboard/(product|users)" src`

Expected: every match is either removed or belongs to reusable infrastructure; no compiled source imports a deleted module.

- [ ] **Step 6: Rename the package and synchronize dependencies**

Set `package.json` name to `dev-one`, then run `bun install`.

- [ ] **Step 7: Prove the stripped base compiles**

Run: `bun run typecheck`

Expected: exit code 0.

- [ ] **Step 8: Commit the imported base**

```bash
git add -A
git commit -m "chore: import dashboard starter"
```

---

### Task 2: Brand the DevOne shell

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/config/nav-config.ts`
- Modify: `src/components/layout/app-sidebar.tsx`
- Replace: `src/app/dashboard/overview/`
- Create: `src/app/dashboard/[section]/page.tsx`

**Interfaces:**
- Consumes: the starter's `PageContainer`, card primitives, dashboard layout, and `NavGroup` type
- Produces: `/dashboard/overview` and placeholder routes for `projects`, `issues`, `database`, `erd`, `git`, `api`, `docs`, `devops`, and `settings`

- [ ] **Step 1: Make the root route deterministic**

Replace `src/app/page.tsx` with a server redirect:

```tsx
import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/dashboard/overview');
}
```

- [ ] **Step 2: Replace application metadata**

Set the default title to `DevOne`, title template to `%s | DevOne`, and description to `One workspace for everything developers need.` in `src/app/layout.tsx`. Remove starter-specific social image metadata.

- [ ] **Step 3: Replace navigation with DevOne product areas**

Set `navGroups` to one `Workspace` group containing Dashboard plus Projects, Issues, Database, ERD, Git, API, Docs, DevOps, and Settings. Use only icon keys already registered in `src/components/icons.tsx`.

- [ ] **Step 4: Replace visible starter branding**

Change the sidebar product name and accessible label to `DevOne`; remove the starter GitHub CTA if it remains after cleanup.

- [ ] **Step 5: Build the overview page**

Use `PageContainer` and existing card primitives to render the DevOne tagline, four zero-state summary cards (Projects, Open Issues, Pull Requests, Databases), and a clear empty state explaining that connections will be added in later slices. Keep all values static and local.

- [ ] **Step 6: Add one shared placeholder route**

Create `src/app/dashboard/[section]/page.tsx` with a fixed title/description map for the nine section slugs. Call `notFound()` for any unknown slug and render known sections through `PageContainer`.

- [ ] **Step 7: Prove navigation and route types compile**

Run: `bun run typecheck`

Expected: exit code 0.

- [ ] **Step 8: Commit the DevOne shell**

```bash
git add -A
git commit -m "feat: add DevOne dashboard shell"
```

---

### Task 3: Verify the runnable foundation

**Files:**
- Modify only if required by verification: files introduced by Tasks 1-2

**Interfaces:**
- Consumes: the complete DevOne shell
- Produces: evidence that formatting, linting, types, and the production bundle are valid

- [ ] **Step 1: Run formatting**

Run: `bun run format`

Expected: exit code 0.

- [ ] **Step 2: Run static checks**

Run: `bun run lint:strict && bun run typecheck`

Expected: both commands exit 0 with no warnings or errors.

- [ ] **Step 3: Run the production build**

Run: `bun run build`

Expected: exit code 0 and generated routes for `/`, `/dashboard/overview`, and `/dashboard/[section]`.

- [ ] **Step 4: Confirm Clerk is absent**

Run: `rg -n "@clerk|CLERK_|clerk\.com" package.json src env.example.txt Dockerfile Dockerfile.bun`

Expected: no matches.

- [ ] **Step 5: Commit verification formatting or fixes**

```bash
git add -A
git commit -m "chore: verify DevOne foundation"
```

Skip the commit when verification makes no tracked changes.
