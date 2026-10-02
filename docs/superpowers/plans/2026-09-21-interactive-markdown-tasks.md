# Interactive Markdown Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repository Markdown task checkboxes persist through revision-protected GitHub/GitLab commits while adding bounded, resizable, full-screen previews.

**Architecture:** Extend the existing provider seam with revision-bearing file reads and one revision-pinned update operation. Keep membership and writable-branch enforcement in the git service, expose one validated server action, and place optimistic interaction plus preview controls in a focused client component.

**Tech Stack:** Next.js 16 server actions, React 19, TypeScript, marked, DOMPurify, GitHub Contents API, GitLab Repository Files API.

**Spec:** `docs/superpowers/specs/2026-09-21-interactive-markdown-tasks-design.md`

## Global Constraints

- Do not create a git commit.
- Keep Markdown sanitized through the existing `renderMarkdown` boundary.
- Modify only `.md` and `.markdown` repository previews; non-Markdown previews remain raw source.
- Reject stale revisions and non-branch references rather than overwriting remote content.
- Reuse the existing repository membership authorization in `openRepository`.

---

### Task 1: Task marker replacement

**Files:**
- Create: `src/features/git/markdown-tasks.ts`
- Modify: `scripts/check-core.ts`

**Interfaces:**
- Produces: `toggleMarkdownTask(source: string, taskIndex: number, checked: boolean): string`

- [ ] Add failing assertions proving the nth task marker changes without relying on task text and uppercase `[X]` is supported.
- [ ] Run `bun scripts/check-core.ts` and confirm the missing export fails.
- [ ] Implement a line-oriented task-marker replacement that throws for an invalid index.
- [ ] Run `bun scripts/check-core.ts` and confirm the assertions pass.

### Task 2: Revision-protected provider writes

**Files:**
- Modify: `src/lib/git/provider.ts`
- Modify: `src/lib/git/github.ts`
- Modify: `src/lib/git/gitlab.ts`
- Modify: `scripts/check-core.ts`

**Interfaces:**
- Changes `GitFileContent` reads to include `revision: string`.
- Produces `GitProviderClient.updateFile(token, repositoryId, input)` where input contains `path`, `branch`, `content`, `message`, and `revision`.
- Produces `ProviderConflictError` for stale writes.

- [ ] Add failing provider assertions for revision parsing and exact GitHub/GitLab update requests.
- [ ] Run the focused core check and confirm provider assertions fail.
- [ ] Add revision fields to provider file schemas and return values.
- [ ] Implement GitHub Contents API and GitLab Repository Files API updates with revision fields.
- [ ] Map conflict responses to `ProviderConflictError` while preserving authentication/unavailable handling.
- [ ] Run the focused core check and confirm provider assertions pass.

### Task 3: Authorized update service and action

**Files:**
- Modify: `src/features/git/service.ts`
- Create: `src/features/git/actions.ts`
- Modify: `scripts/check-database.ts`

**Interfaces:**
- Produces `updateRepositoryMarkdownTask(userId, repositoryId, input): Promise<{ revision: string }>`.
- Produces `updateRepositoryMarkdownTaskAction(input): Promise<{ ok: boolean; revision?: string; error?: string }>`.

- [ ] Add failing database assertions for non-member rejection and non-branch ref rejection.
- [ ] Run `bun run test:db` and confirm the missing service fails.
- [ ] Implement service validation: safe path, Markdown extension, branch existence, source/revision forwarding, and provider update.
- [ ] Implement the authenticated Zod-validated server action with conflict-specific feedback.
- [ ] Run the database check and confirm authorization/reference assertions pass.

### Task 4: Interactive bounded preview

**Files:**
- Create: `src/features/git/components/repository-markdown-preview.tsx`
- Modify: `src/app/projects/[projectId]/git/page.tsx`
- Modify: `scripts/check-devone-sections.ts`

**Interfaces:**
- Consumes `toggleMarkdownTask` and `updateRepositoryMarkdownTaskAction`.
- Component props: `repositoryId`, `path`, `branch`, `initialSource`, and `initialRevision`.

- [ ] Add failing source assertions for the interactive Markdown preview, full-screen control, and use from the file browser.
- [ ] Run `bun scripts/check-devone-sections.ts` and confirm the assertions fail.
- [ ] Build the client component using sanitized `renderMarkdown`, delegated checkbox events, optimistic source/revision state, rollback, pending feedback, native `resize-y`, bounded scrolling, and a full-screen dialog.
- [ ] Render the component for `.md`/`.markdown`; leave other files in the existing `<pre>`.
- [ ] Run the section check and confirm it passes.

### Task 5: Complete verification

**Files:**
- No production changes unless verification exposes a defect.

- [ ] Run `bun run db:generate`.
- [ ] Run `bun run typecheck`.
- [ ] Run `bun run test`.
- [ ] Run `bun run test:db`.
- [ ] Run `bun run lint` on the changed codebase.
- [ ] Review the final diff for unrelated changes and confirm no git commit was created.
