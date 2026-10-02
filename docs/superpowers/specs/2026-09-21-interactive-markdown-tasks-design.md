# Interactive Markdown Tasks Design

## Goal

Render repository Markdown files as a bounded, resizable preview whose task-list checkboxes can be toggled and persisted as a commit to the selected GitHub or GitLab branch.

## Behavior

- `.md` and `.markdown` files render as sanitized GitHub-flavored Markdown; other files keep the existing raw source preview.
- The preview has a bounded default/max height, supports native vertical resizing, and can open in a full-screen dialog.
- Markdown task-list checkboxes are interactive. Clicking one changes only its corresponding source marker (`[ ]`, `[x]`, or `[X]`).
- A checkbox change is shown optimistically, then committed directly to the selected branch.
- Only one checkbox update can be pending at a time. A failed update restores the prior content and shows a useful error.
- Provider revision checks prevent overwriting a file changed since it was loaded. Conflicts require a refresh.
- The automatic commit message is `docs: update task in <filename>`.
- Arbitrary commit SHA and tag references are not writable; the selected ref must match a repository branch.
- DevOne repository changes are not committed by this implementation.

## Architecture

`GitProviderClient` gains focused file-update support and returns a file revision with reads. GitHub uses the Contents API (`PUT`, `sha`, and `branch`); GitLab uses the Repository Files API (`PUT`, `branch`, and `last_commit_id`). The git service keeps membership authorization and verifies that the requested ref is a branch before forwarding a revision-pinned write.

A server action authenticates the current user and validates the mutation payload. A client-side Markdown repository preview owns optimistic checkbox state, task-marker replacement, save feedback, vertical resize, and full-screen presentation. Existing `renderMarkdown` sanitation remains the rendering boundary.

## Safety and errors

- Repository paths continue through `assertSafeRepositoryPath`.
- Membership remains mandatory through `openRepository`.
- Updates include the revision returned by the initial file read.
- Provider `409`/`422` stale-write responses become a conflict error rather than an overwrite.
- Authentication/provider errors are returned as user-readable action failures without exposing tokens.
- Sanitization remains enabled; checkbox interaction is attached after rendering rather than injecting unsanitized HTML.

## Verification

- Unit assertions cover exact nth-task-marker replacement, including duplicate task text and uppercase checked markers.
- Provider checks cover GitHub and GitLab update URLs, methods, auth headers, branch, revision, Base64/content payload, and conflict mapping.
- Service checks cover membership and writable-branch enforcement.
- TypeScript and existing core/database checks remain green.
- Manual verification covers bounded height, vertical resizing, full-screen mode, optimistic save, rollback, and refresh persistence.
