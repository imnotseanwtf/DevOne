# Tech Stack

Everything DevOne is built with, grouped by what it does. Versions match `package.json`.
[By feature](#by-feature) at the end shows which pieces each part of the app uses.

## Platform

| Technology | Version | Used for |
| --- | --- | --- |
| [Next.js](https://nextjs.org) | 16.2 | App Router, server components, server actions, route handlers |
| [React](https://react.dev) | 19.2 | UI (including `useOptimistic` and `useTransition`) |
| [TypeScript](https://www.typescriptlang.org) | 5.7 | The whole codebase |
| [Node.js](https://nodejs.org) | 22 | Runtime (`.nvmrc`, `Dockerfile`) |
| [Bun](https://bun.sh) | 1.x | Package manager, scripts and tests (`Dockerfile.bun` is an alternative image) |

## Database

| Technology | Version | Used for |
| --- | --- | --- |
| [PostgreSQL](https://www.postgresql.org) | 16+ | DevOne's own database ([Neon](https://neon.tech) in production) |
| [Prisma](https://www.prisma.io) (`prisma`, `@prisma/client`) | 7.10 | Schema, migrations and queries (`prisma/schema.prisma`, `prisma.config.ts`) |
| `@prisma/adapter-pg` + [`pg`](https://node-postgres.com) | 7.10 / 8.23 | Prisma's Postgres driver; also connects to users' Postgres databases in the Database browser |
| [`mysql2`](https://sidorares.github.io/node-mysql2/docs) | 3.24 | Connects to users' MySQL databases in the Database browser |
| [`dotenv`](https://github.com/motdotla/dotenv) | 17.4 | Loads `.env` for the Prisma CLI (`prisma.config.ts`) |
| [Redis](https://redis.io) | — | Included in `compose.yaml` for local development |

## UI and styling

| Library | Version | Used for |
| --- | --- | --- |
| [shadcn/ui](https://ui.shadcn.com) | — | Component source in `src/components/ui` (on Base UI) |
| [Base UI](https://base-ui.com) (`@base-ui/react`) | 1.6 | Accessible primitives under shadcn/ui (dialogs, menus, popovers, …) |
| `@shadcn/react` | 0.2 | Message scroller component |
| [Tailwind CSS](https://tailwindcss.com) (`tailwindcss`, `@tailwindcss/postcss`, `postcss`) | 4.2 | Styling, with OKLCH theme tokens (see [themes.md](./themes.md)) |
| [`tw-animate-css`](https://github.com/Wombosvideo/tw-animate-css) | 1.4 | Enter/exit animations |
| `class-variance-authority`, `clsx`, `tailwind-merge` | — | Component variants and class merging (`cn()`) |
| [Tabler Icons](https://tabler.io/icons) (`@tabler/icons-react`) | 3.40 | Every icon, re-exported only from `@/components/icons` |
| [`next-themes`](https://github.com/pacocoursey/next-themes) | 0.4 | Light/dark mode |
| [`sonner`](https://sonner.emilkowal.ski) | 1.7 | Toast notifications |
| [`nextjs-toploader`](https://github.com/TheSGJ/nextjs-toploader) | 3.9 | Page-change progress bar |
| [`cmdk`](https://cmdk.paco.me) | 1.1 | Command menu component |
| [`kbar`](https://kbar.vercel.app) | 0.1 | ⌘K search / command palette |
| [`react-resizable-panels`](https://github.com/bvaughn/react-resizable-panels) | 4.12 | Resizable panes (Git workbench) |
| [`react-day-picker`](https://daypicker.dev) + [`date-fns`](https://date-fns.org) | 10.0 / 4.1 | Calendar, date pickers and date formatting |
| [`recharts`](https://recharts.org) | 3.8 | Charts |
| [`embla-carousel-react`](https://www.embla-carousel.com) | 8.6 | Carousel component |
| [`input-otp`](https://input-otp.rodz.dev) | 1.4 | One-time code input |
| [`react-dropzone`](https://react-dropzone.js.org) | 14.4 | File upload drop zone |

## Data, state and forms

| Library | Version | Used for |
| --- | --- | --- |
| [TanStack Query](https://tanstack.com/query) (`@tanstack/react-query`, devtools) | 5.95 | All data fetching and caching (prefetch on the server, `useSuspenseQuery` on the client) |
| [TanStack Form](https://tanstack.com/form) (`@tanstack/react-form`) | 1.28 | Forms through `useAppForm` (see [forms.md](./forms.md)) |
| [TanStack Table](https://tanstack.com/table) (`@tanstack/react-table`) | 8.21 | Data tables |
| [Zod](https://zod.dev) | 4.3 | Validation for forms, server actions and API input |
| [`nuqs`](https://nuqs.47ng.com) | 2.8 | Typed URL search-param state |

## Editors and canvases

| Library | Version | Used for |
| --- | --- | --- |
| [CodeMirror 6](https://codemirror.net) (`codemirror`, `@codemirror/*`, `@lezer/highlight`) | 6.x | Git workbench editor, SQL editor and API client editors |
| `@codemirror/language-data` | 6.5 | Syntax highlighting for 140+ languages, loaded on demand |
| `@codemirror/merge` | 6.12 | Side-by-side diff view in the Git workbench |
| `@codemirror/lang-sql`, `lang-json`, `lang-javascript` | 6.x | Database SQL editor and the API client's body/script editors |
| [MDXEditor](https://mdxeditor.dev) (`@mdxeditor/editor`) | 4.2 | Rich Markdown editor for Docs and task descriptions |
| [`marked`](https://marked.js.org) + [DOMPurify](https://github.com/cure53/DOMPurify) | 18.0 / 3.4 | Markdown rendering and HTML sanitizing |
| [Excalidraw](https://excalidraw.com) (`@excalidraw/excalidraw`) | 0.18.1 | Sketches in Drawings, with DevOne's own live sync (`reconcileElements`, collaborator cursors) |
| [excalidraw.com](https://excalidraw.com) | — | Older embedded sessions, and importing `#room=` / `#json=` links |
| [draw.io](https://www.drawio.com) (embed mode) | — | Diagrams in Drawings, embedded from `embed.diagrams.net` or `NEXT_PUBLIC_DRAWIO_URL` |
| [React Flow](https://reactflow.dev) (`@xyflow/react`) | 12.11 | ERD diagram in the Database browser |
| [`yaml`](https://eemeli.org/yaml) | 2.9 | Reading OpenAPI YAML (and JSON) documents in the API client |
| [xterm.js](https://xtermjs.org) (`@xterm/xterm`, `@xterm/addon-fit`) | 6.0 / 0.11 | DevOps SSH terminal and CI job logs (ANSI colours) |
| [`ssh2`](https://github.com/mscdex/ssh2) | 1.17 | Server-side SSH client behind the DevOps terminal |

## Built into the platform (no extra package)

| API | Used for |
| --- | --- |
| `node:crypto` (AES-256-GCM, `randomBytes`) | Encrypting stored tokens, database passwords and resource keys and credentials (`src/lib/encryption`) |
| Web Crypto (`crypto.subtle`, `crypto.randomUUID`) | Decrypting imported Excalidraw links (AES-GCM); ids per open browser tab for live presence |
| `node:zlib` | Inflating Excalidraw's compressed share links |
| `node:net` (`isIP`) | Blocking private-network targets in the API client and self-hosted Git hosts |
| `fetch` + server actions | Live drawing sync (polling about once a second against Postgres, no WebSocket server) |
| HTML drag and drop | Board cards and columns, Docs/Drawings folders, Git explorer files |

## File formats DevOne reads

| Format | Where | Code |
| --- | --- | --- |
| OpenAPI 3.x / Swagger 2.0 (JSON or YAML) | API → Import JSON | `src/lib/api-client/openapi.ts` |
| Postman collections v2.0 / v2.1 (JSON) | API → Import JSON (variables become a resource's keys) | `src/lib/api-client/postman.ts` |
| cURL commands | API → Import cURL | `src/lib/api-client/curl.ts` |
| Excalidraw `#json=` share links and `#room=` sessions | Drawings → Import from Excalidraw | `src/lib/excalidraw/import.ts` |
| Excalidraw scenes and draw.io XML | Stored per drawing | `src/features/drawings` |

## Integrations

| Service | Used for |
| --- | --- |
| GitHub and GitLab (REST APIs, OAuth and personal access tokens) | Sign-in, repositories, branches, files, commits, pull/merge requests, CI pipelines, jobs and job logs |
| Neon | Hosted PostgreSQL in production |
| Vercel | Hosting and deploys (see [deployment.md](./deployment.md)) |
| Docker | `Dockerfile`, `Dockerfile.bun` and `compose.yaml` (Postgres + Redis) for self-hosting |
| diagrams.net (`embed.diagrams.net`) | The draw.io editor iframe (or a self-hosted copy) |
| Excalidraw backends (`json.excalidraw.com`, Firestore and Firebase Storage of `excalidraw-room-persistence`) | Only for importing Excalidraw links, and for older embedded sessions |

## Tooling

| Tool | Version | Used for |
| --- | --- | --- |
| [Oxlint](https://oxc.rs/docs/guide/usage/linter) | 1.57 | Linting (`bun run lint`) |
| [Oxfmt](https://oxc.rs) | 0.42 | Formatting (`bun run format`) |
| [Husky](https://typicode.github.io/husky) + [lint-staged](https://github.com/lint-staged/lint-staged) | 9.1 / 15.5 | Pre-commit formatting; pre-push build check |
| `scripts/check-*.ts` (run with Bun) | — | Unit and service tests (`bun run test`, `bun run test:db`) |
| Playwright | — | Manual browser checks during development (not a project dependency) |

## Installed but not imported

These are in `package.json` but no source file imports them. They are either used indirectly or left over from the starter kit:

| Package | Notes |
| --- | --- |
| `sharp` | Used by Next.js itself for image optimization |
| `vaul` | Drawer component from the starter kit; nothing uses it |
| `react-responsive` | Nothing uses it |
| `tailwindcss-animate` | Replaced by `tw-animate-css` |

## By feature

| Feature | Main pieces |
| --- | --- |
| Board (tasks) | Server actions + Prisma, HTML drag and drop with optimistic updates, MDXEditor for descriptions, archive (`Issue.archivedAt`) |
| Docs | MDXEditor, `marked` + DOMPurify, shared folder list (`ContentFolder`, `useOptimistic`) |
| Drawings | Excalidraw with DevOne live sync (`DrawingElement`, `DrawingPresence`), draw.io embed, Excalidraw link import |
| Git | GitHub/GitLab REST APIs, CodeMirror 6 (+ `language-data`, `merge`), `react-resizable-panels` |
| Database | `pg`, `mysql2`, TanStack Table, CodeMirror SQL, React Flow (ERD), `react-day-picker` |
| DevOps | Pipelines per merge request, jobs and logs from the GitHub/GitLab APIs; SSH terminal: `ssh2` on the server, xterm.js in the browser, Server-Sent Events + POSTs in between (`src/app/api/ssh`) |
| API client | CodeMirror, `yaml`, OpenAPI / Postman / cURL importers; environments are project resources |
| Settings / My account / Admin | Server actions + Prisma, audit log (`AuditEvent`), user preferences (`User.preferences`) |
| Languages | Own typed dictionaries in `src/i18n` (English, Filipino); `getT()` on the server, `useT()` in the browser |
| Sign-in | GitHub/GitLab OAuth and personal access tokens, encrypted tokens, database-backed sessions |
