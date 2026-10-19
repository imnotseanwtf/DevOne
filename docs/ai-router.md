# AI gateway

DevOne exposes one gateway at `https://your-devone/api/ai/v1`, building on the routing approach
in [9Router](https://github.com/decolua/9router). Providers define the upstream API and model
names; accounts hold encrypted credentials and have independent priority, allowed models,
expiry and cooldown. Existing provider keys, gateway keys and combos keep working.

## Set it up

Open **Router** from the username menu. It has its own screen with tabs and no sidebar:
**Providers**, **Endpoint & Keys**, **Combos**, **Usage** and **Settings**. Administrators manage
shared providers and accounts; everyone can create their own keys under **Endpoint & Keys**.

**Free Tier Providers → OpenCode Free** sets up the public OpenCode transport without a provider
API key and discovers the current free Chat models, including Big Pickle. OpenCode controls
availability and quotas. Models requiring the separate SystemOne or Responses upstream are
excluded from this adapter. **OpenCode Zen** remains the separate account-key provider. External
clients still authenticate to DevOne with their own gateway key from **Endpoint & Keys**.
The transport follows [9Router's OpenCode adapter](https://github.com/decolua/9router/blob/master/open-sse/providers/registry/opencode.js);
the model catalog is documented in [OpenCode Zen](https://opencode.ai/docs/zen/).

1. For Claude OAuth, choose **Providers → Claude**, then **Add account** if the provider already
   exists. An unconfigured Claude card starts sign-in immediately and creates its provider.
   Open sign-in, approve access on the provider's page and paste Claude's displayed authorization
   code into DevOne. The grant is exchanged and encrypted before returning to Router.
   Claude and Codex include their public native-client identities; no provider
   client ID or redirect environment variables are required for built-in sign-in.
2. For API providers, choose a provider card to start from its preset. For custom endpoints,
   choose **Add OpenAI Compatible** or **Add Anthropic Compatible**. Choose authentication,
   enter a credential and use **Fetch models**, or enter model IDs one per line. Discovery is
   provider-dependent; manual entry works when an upstream has no model-list endpoint.
3. Open a configured provider card to manage its accounts and models. **Add account** adds
   another credential under that provider. Each account has independent priority, model access,
   activation and cooldown. Empty credentials keep the saved value during editing. Credentials
   are encrypted with `DEVONE_ENCRYPTION_KEY` and never returned after saving. Catalog counts
   show saved accounts and locally available accounts, rather than a live upstream health check.
   **Refresh models** adds IDs from the provider's live catalog without changing your first
   model, credentials or account cooldowns. Claude OAuth discovery authenticates with the saved
   account even during an inference cooldown; listing a model does not guarantee inference access.
4. For custom OAuth providers, save the provider and use **Add account** or **Save and connect**.
   Each authorization creates an account. Configure the installation's OAuth application before
   connecting. Reconnect after revocation or when refresh is no longer available.
5. Use **Combos** to create an ordered list of provider/model pairs such as `free-stack`.
6. Under **Settings**, set a default model and optionally shorten large tool results. **Usage**
   shows installation requests, failures, token counts and saved tool-output characters.
7. Open **Endpoint & Keys → Create key**. Copy the `dvo_…` key when shown; it cannot be displayed
   again. Use the copyable base URL, model IDs and Chat, Messages or Responses request examples
   to configure your tools. Each person has independent gateway keys.

Old `/admin?tab=ai` and `/account?tab=ai` bookmarks redirect to Router.

### OpenCode runtime on Vercel

The **OpenCode Free** provider always runs the pinned Linux OpenCode executable inside
the existing Node function. Deploy these changes to enable it; no environment toggle or
separate server is required. The binary is included through Next's file tracing; keep optional
dependencies enabled during installation. Do not set `DEVONE_AI_OPENCODE_BIN` on Vercel.

After deployment, open **Router → Providers → OpenCode Free → Test connection** and
run a quick test with `big-pickle`. This is the live check from Vercel's network.
Native OpenCode returned a real reply in the local probe, but that does not establish
access from every hosting network. Upstream restrictions, availability and quotas still apply.

Runtime mode currently supports text chat. It sends the conversation as a JSON transcript
to a fresh OpenCode session and returns its completed text through the gateway's normal
JSON/SSE translation. It does not stream individual tokens. Caller tools, tool results,
images and unsupported generation options return an explicit error. Output limits from
1 to 8192 tokens are accepted (2048 by default). This mode uses the executable's bundled
model catalog. Native agent overhead also counts toward the usage recorded by the gateway.

Each process uses a fresh directory under `/tmp`, receives no DevOne credentials, has
external plugins/config discovery disabled, and is killed on cancellation or after at most
60 seconds. The CLI retains its native tool declarations, but all tool permission requests
are automatically rejected by non-interactive `run` without `--auto`. Temporary sessions
are removed after the process exits. The existing 30-second connection-test deadline also applies.

For local testing on another platform, set `DEVONE_AI_OPENCODE_BIN` to an absolute path to
a compatible OpenCode executable. `bun run test:ai:runtime:live` sends one fixed prompt through
the installed executable; it needs network access and consumes free-tier usage. The normal
test suite uses a local child-process fixture and makes no model requests.

### Hosted OAuth callbacks

Set `DEVONE_APP_URL` to your public origin, for example `https://dev-one.bantaybenta.store`.
The bundled native clients cannot register arbitrary deployment domains as OAuth redirects.
Leave `DEVONE_AI_CLAUDE_REDIRECT_URI` and `DEVONE_AI_CODEX_REDIRECT_URI` unset for built-in sign-in.

- **Claude:** DevOne opens the native client's registered code page at
  `https://platform.claude.com/oauth/code/callback`. Paste the complete authorization code
  (including `#state`, when present) or the full callback URL into the DevOne completion page.
  The original encrypted PKCE verifier, administrator and state are checked before exchange.
- **Codex on Vercel or another hosted origin:** DevOne uses the
  [official Codex device-code flow](https://github.com/openai/codex/blob/main/codex-rs/login/src/device_code_auth.rs).
  Open sign-in and enter the displayed one-time code. Enable device-code authorization in
  ChatGPT security settings if prompted. DevOne polls for approval and stores the resulting
  account without binding a localhost port. The polling credential stays encrypted on the server.
- **Separately registered/custom clients:** register the exact configured redirect with the
  provider. Without an override, this is `<DEVONE_APP_URL>/api/ai/oauth/<saved-provider-id>/callback`.
  An explicit same-origin `/callback` is also supported and resolves the provider from saved state.

GitHub/GitLab application login uses your own OAuth applications. Register these exact URLs in
their application settings (substitute your domain):

| Provider | Registered callback |
| --- | --- |
| GitHub | `https://dev-one.bantaybenta.store/api/auth/github/callback` |
| GitLab | `https://dev-one.bantaybenta.store/api/auth/gitlab/callback` |

The provider's allow-list must match; adding a route in DevOne does not change that registration.
After deploying callback changes, start a new sign-in instead of reusing an old authorization URL.

### Local Codex sign-in

DevOne bundles the public client identity `app_EMoamEEZ73f0CkXaXp7hrann` and loopback callback
`http://localhost:1455/auth/callback` used by
[9Router's Codex provider](https://github.com/decolua/9router/blob/master/open-sse/providers/registry/codex.js).
Leave `DEVONE_AI_CODEX_CLIENT_ID` and `DEVONE_AI_CODEX_REDIRECT_URI` unset or empty to use them.
Choose **Providers → Codex** to sign in with your ChatGPT account. DevOne opens its local
callback listener before authorization, validates the saved OAuth state, and relays the code
to the authenticated callback for encrypted account storage. Port 1455 must be free, and
DevOne and the browser must run on the same computer. The listener expires after ten minutes.
A separately registered client can continue using the installation's own callback URI.

The Codex catalog starts with current text models from 9Router; **Refresh models** requests
the account's native catalog with its workspace header. Image-only models are excluded from
the chat catalog. Responses Lite models use the corresponding input prefix and header while
preserving caller instructions/tools. Sign-in and a successful connection test confirm actual
account access; a preset/model-list entry alone does not.

Each provider account has **Test connection**. Choose one of its allowed models, run **Quick test**
or send a message in the test chat. The dialog shows the reply, upstream errors and elapsed time.
Its layout adapts the starter's [AI Chat design](https://github.com/Kiranism/next-shadcn-dashboard-starter/blob/main/src/features/ai-chat/components/ai-chat-demo.tsx):
assistant header, status badge, avatars, anchored messages, thinking indicator and bottom composer.
Tests use the exact selected account with its normal credential refresh and usage tracking;
enable the provider/account and clear any cooldown first. Closing the dialog cancels the request.
Chat stays in the browser for the open dialog. Tests have a 30-second deadline and a 512-token
output limit where supported; Codex omits the unsupported token-limit field. Replies are capped
at 8000 displayed characters so subsequent chat remains within the diagnostic message limit.

Claude OAuth requests include the Claude Code system block used by
[9Router's translator](https://github.com/decolua/9router/blob/master/open-sse/translator/request/openai-to-claude.js).
The caller's existing instructions, messages and tools are preserved. This preparation is shared
by gateway requests and connection tests; API-key and custom transports keep their own payloads.

Claude thinking is returned separately as `reasoning_content` to Chat clients and reasoning items
to Responses clients. Native Messages clients retain signed thinking and redacted blocks, including
when an upstream stream is buffered into JSON. Opaque signatures/redacted data are not exposed as
answer text or forwarded to other protocols.

`bun run test:ai:chat-ui` checks exact-account selection, allowed models, quick tests, drafts,
follow-up history, long replies, errors, cancellation, mobile layout and member authorization.
It uses temporary database records and a local upstream on `127.0.0.1:18081`; that host must be
in `DEVONE_AI_ALLOWED_HOSTS`. Set `DEVONE_PLAYWRIGHT_PATH` when Playwright is outside the repository.

Gateway keys authenticate clients to DevOne. Provider credentials authenticate DevOne to the
upstream; these are separate. A signed-in browser on the same site can use its DevOne session.
The gateway is disabled in the public demo.

## Supported formats

| Client endpoint | Request/response format |
| --- | --- |
| `POST /api/ai/v1/chat/completions` | OpenAI Chat Completions |
| `POST /api/ai/v1/messages` | Anthropic Messages |
| `POST /api/ai/v1/responses` | OpenAI Responses |
| `GET /api/ai/v1/models` | Gateway model catalog |

The gateway translates supported text, image blocks, tool calls/results, finish reasons and
usage between these formats, including streamed responses. Unsupported request translations
return HTTP 400; unsupported upstream output produces a gateway error. Native routing preserves
provider-specific fields when the client and upstream formats match, subject to the selected
executor's requirements. Cross-format conversion does not support Claude extended thinking,
hosted tools or stateful Responses features. Unrelated image generation, speech and search APIs
are outside this rollout. Test the request shapes your client uses before relying on a new provider.

Presets include OpenAI-compatible services, Anthropic API-key Messages, Ollama, Claude OAuth
and Codex OAuth. Model catalogs and account entitlements come from your upstream; the presets
do not promise availability of a particular model or subscription. Select the upstream format
that your configured endpoint supports. Claude and Codex use the public client identities
from 9Router by default, with environment overrides for separately registered applications.

## OAuth installation configuration

Set `DEVONE_APP_URL` to the address you use to open DevOne: HTTPS for a public installation,
or an HTTP localhost address for development. The provider client IDs, endpoints and scopes
are bundled from 9Router's registry; DevOne does not fetch configuration from 9Router at runtime.

| Provider | Public client ID | Default callback |
| --- | --- | --- |
| [Claude](https://github.com/decolua/9router/blob/master/open-sse/providers/registry/claude.js) | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` | `<DEVONE_APP_URL>/callback` |
| [Codex](https://github.com/decolua/9router/blob/master/open-sse/providers/registry/codex.js) | `app_EMoamEEZ73f0CkXaXp7hrann` | `http://localhost:1455/auth/callback` |

Claude follows [9Router's `/callback` convention](https://github.com/decolua/9router/blob/master/src/lib/oauth/services/oauth.js)
using the configured DevOne address and port. Start sign-in from that same address so its
session cookie is present when authorization returns. The shared callback resolves the provider
from the saved state; the browser does not choose which account receives the authorization code.
Codex's built-in callback requires a local installation as described above.

For a separately registered application, override the client ID with these optional variables:

```dotenv
DEVONE_AI_CLAUDE_CLIENT_ID=your-registered-client-id
DEVONE_AI_CLAUDE_CLIENT_SECRET=
DEVONE_AI_CODEX_CLIENT_ID=your-registered-client-id
DEVONE_AI_CODEX_CLIENT_SECRET=
```

Each prefix accepts `AUTHORIZE_URL`, `TOKEN_URL`, `SCOPE`, `TOKEN_ENCODING` (`form` or `json`),
`REDIRECT_URI` and `REFRESH_LEAD_MS`. Empty values use the built-in defaults. Configure
`CLIENT_SECRET` only when your application requires it. A different client ID uses
`<DEVONE_APP_URL>/api/ai/oauth/<provider-record-id>/callback` unless `REDIRECT_URI` is set;
the ID belongs to the saved provider record, not the preset name. Register that exact callback
with your application. Callback overrides must match the app origin and use `/callback` or
the provider's normal callback path, except for Codex's fixed local callback.

For a custom OAuth provider, set all required endpoint configuration:

```dotenv
DEVONE_AI_CUSTOM_CLIENT_ID=your-registered-client-id
DEVONE_AI_CUSTOM_AUTHORIZE_URL=https://provider.example/oauth/authorize
DEVONE_AI_CUSTOM_TOKEN_URL=https://provider.example/oauth/token
DEVONE_AI_CUSTOM_SCOPE=your-required-scopes
DEVONE_AI_CUSTOM_TOKEN_ENCODING=form
DEVONE_AI_CUSTOM_CLIENT_SECRET=
```

The provider registry also accepts `BASE_URL`, `FORMAT`, `PATH`, `AUTH_HEADER` and `AUTH_SCHEME`
(`raw` or `bearer`) under the corresponding prefix for transport overrides. Keep configuration
aligned with the provider form. Credentials and tokens belong to encrypted accounts, not these
installation variables.

Authorization uses PKCE S256. State is bound to the signed-in administrator and provider,
expires, and can only be consumed once. Refresh tokens are rotated under a per-account lock
and saved encrypted. Custom OAuth providers without client configuration are shown in the UI
as OAuth being unavailable.

## Local and custom endpoints

Public upstreams use HTTPS. Local/private inference requires an explicit entry in
`DEVONE_AI_ALLOWED_HOSTS`, matched against the exact URL host and port:

```dotenv
DEVONE_AI_ALLOWED_HOSTS=localhost:11434
```

Set the Ollama base URL to `http://localhost:11434/v1` only if the DevOne server can reach it
there. Inside a container, `localhost` is that container; use the inference server's reachable
hostname and port and allow that exact address instead. Metadata-service addresses stay blocked
even when allowlisted. Upstream redirects are rejected to prevent forwarding credentials to
another destination. JSON request bodies are limited to 1 MiB.

## Which model to ask for

| `model` | Routing |
| --- | --- |
| A combo name, such as `free-stack` | Combo steps in order |
| `auto` | Enabled providers' first models, lowest provider priority first |
| A plain model ID | Enabled providers listing it, lowest priority first |
| `Provider name/model` or `alias/model` | The selected provider and requested model |
| An unconfigured model name | Configured default model, if one is set |

Every request must include a nonempty `model`. The default is a fallback for a name with no
configured provider/model match; it does not replace a known model merely because its accounts
are disabled or cooling down. Leave the default empty to return an error for unknown model names.

Within each provider, active accounts are tried in priority order. A model restriction can
exclude an account; an empty list permits all provider models. Accounts cooling down are
excluded until the cooldown expires. **Try again now** clears an account's cooldown.

## Fallback and usage

The gateway tries another eligible account or provider after transient network failures,
timeouts, rate limits, quota/authentication failures and eligible upstream status errors.
Malformed requests fail immediately. A stalled upstream is timed out, and client cancellation
stops the upstream request. Fallback stops after output begins; a stream cannot be safely
restarted on another account once the client has received it. Streaming error events are
reported as failures.

Responses expose `x-devone-provider`, `x-devone-model` and `x-devone-attempts`. **Router → Usage** shows recent requests, token counts, attempts, status and saved characters from tool
output compression. Compression changes tool-result text only; IDs and tool-call structure are
preserved. Compression is enabled by default; turn it off in router settings or send
`X-DevOne-Token-Saver: off` for a single request.

`DEVONE_AI_RATE_LIMIT` limits requests per person per minute (default 60; `0` disables the
limit). The request rate limiter is per DevOne process and resets on restart.

## Using it from tools

```bash
curl https://your-devone/api/ai/v1/chat/completions \
  -H "Authorization: Bearer $DEVONE_AI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'
```

For OpenCode, configure an OpenAI-compatible provider:

```json
{
  "provider": {
    "devone": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DevOne",
      "options": { "baseURL": "https://your-devone/api/ai/v1", "apiKey": "{env:DEVONE_AI_KEY}" },
      "models": { "auto": {}, "free-stack": {} }
    }
  }
}
```

Other clients can use the matching Chat, Messages or Responses endpoint with the same gateway
key. Messages clients may send the gateway key in `x-api-key` instead of a Bearer header. Check each upstream's current terms, account access and data handling before sending
private code or enabling an OAuth integration.

## Upgrade an existing installation

Back up the PostgreSQL database and retain the existing `DEVONE_ENCRYPTION_KEY`. Deploy the new
code and apply the included Prisma migration with `bun run db:deploy` (or the deployment's
existing migration step). The additive migration adds provider metadata, account records and
OAuth sessions; every existing provider receives a primary account carrying its encrypted key,
priority and cooldown. Existing providers, combo steps and gateway keys retain their IDs.
Changing the encryption key without re-encrypting data makes saved credentials unreadable.

Confirm the provider and primary account appear under **Router → Providers**, then make a test
request using an existing gateway key before adding OAuth accounts.

## Chat with the docs

Every project's **Docs** page has an **Ask AI** button. It opens a chat docked beside the page you
are reading. It answers from the project's own pages, streaming the answer as it is written, with
the pages it used shown as links under each answer.

- **What the model sees.** The open page, exactly as it is in the editor (saved or not), plus the
  passages of other pages that best match the question and the last few questions, so follow-ups
  like "and the key?" work. No embeddings and no extra service: it is keyword matching over
  paragraph-sized chunks. About 24,000 characters of excerpts go in each time.
- **Editing the open page.** Ask it to fix, shorten, translate or add to the page. It cannot
  change anything itself: it answers with the complete new text, shows how many lines it adds and
  removes, and waits. **Review new text** shows the text; **Apply to page** puts it in the editor,
  which saves it like any other edit; **Undo** puts the previous text back. An edit is only offered
  when the model saw the whole page (a page too long for the budget can be questioned, not
  rewritten), and it cannot be applied after you switch to a different page. It can change the
  page's text, not its title, and it cannot touch other pages.
- **Hover to edit a block.** Move the mouse over a paragraph, heading, list, code block or table
  in the editor: it is outlined and a small AI button appears. Click it, say what to change
  ("make this shorter", "translate to Filipino"), and press Enter. Only that block is rewritten,
  straight in the editor, and the page saves as usual. **Undo** puts the old block back. If the
  page changes while the model is working, the edit is dropped instead of landing in the wrong
  place.
- **Hover to ask.** The text you last pointed at appears above the chat box as "Pointing at", so
  "this" and "here" in your question mean that passage. Click the × to stop pointing.
- **Who may ask.** The server picks the excerpts, so only members of a project can ask about it.
  Requests count against the same per-person rate limit as the router and show up in
  Admin → AI router → Usage.
- **Which model.** A searchable model picker sits in the chat panel's header, under "Ask the docs". It shows
  friendly names, a loading indicator while fetching, and a retry button if loading fails. It lists
  whatever the router offers: `auto`, your combos, plain model names and `Provider/model`
  entries, so adding a provider or combo under Admin → AI router adds it here too. The default is
  `auto` (the router's usual provider order and fallback). That one choice is used by the chat
  and by hover edits (the hover box just shows which model it is using, and the picker is in the chat panel, so open **Ask AI** to change it), and it is remembered in
  your browser; if a remembered model is later removed, it falls back to `auto`. An administrator
  has to add at least one provider first.
- **Off in the public demo** (`DEVONE_DEMO_MODE`), like the rest of the router.

Answers render Markdown through the same HTML sanitizer as the editor's preview, with headings,
lists, tables and code blocks. Copy or regenerate a reply, or stop it while it is streaming. Scrolling
up pauses automatic scrolling; the down arrow returns to the latest message. A proposed edit still
requires **Apply to page**, and **Undo** restores the previous text.

`bun run test:docs:chat-ui` checks model loading/search/retry, exact routing IDs, Markdown,
copy/regenerate, streamed errors, cancellation, scrolling, edit approval/undo and mobile layout.
It requires a local Next dev server and Playwright (set `DEVONE_PLAYWRIGHT_PATH` if installed
outside the project). It creates a temporary preview route and removes it on completion, uses
fixture AI responses, and does not require a database or provider account.

### AI in task descriptions

The description of a task, both in **New task** and when you open an existing task, has the same
AI as the Docs pages:

- **Hover to edit a block.** Hover a paragraph, heading or list in the description, click the
  small AI button, say what to change and press Enter. Only that block changes, and **Undo**
  puts it back. In an existing task the change is part of the form, so it is stored when you
  press **Save changes** (and not at all if you close without saving).
- **Ask AI.** The button above the description opens a chat under the editor. It can answer
  questions about the task and the project's docs, and it can **write a description from
  scratch** ("Write a description for this task") or propose a rewrite of the current one. Like
  everywhere else, it only changes the description when you press **Apply to page**.
- It knows the task's title as you type it, and it reads the project's docs for facts. It cannot
  see other tasks or your code.
- The model is the one picked in the chat's header and is shared with the Docs pages.

## Verification

Run the repository's AI protocol, OAuth and gateway checks alongside typecheck, lint and build.
They use controlled test transports; real-provider validation still requires real credentials,
a reachable upstream and an installed OAuth application.

`bun run test:ai:db` also checks provider creation and concurrent credential locks against the
configured, migrated PostgreSQL database. It removes only the temporary records it creates.
`bun run test:ai:ui` exercises the running local application with temporary PostgreSQL records:
Router navigation, multiple-account add/toggle, key creation/copy-once/deletion, browser history,
mobile layout, member boundaries and Claude OAuth navigation/cancellation. It requires a locally
running server, migrated database and Playwright with Chromium. Set `DEVONE_PLAYWRIGHT_PATH` to
an existing Playwright installation if it is outside the repository. The external consent screen
is intercepted; this check does not sign in to a real provider account.

Development logging suppresses Server Function arguments because they can contain sign-in
tokens and provider credentials.

With a test installation, verify:

1. Existing API-key providers still route, and editing without a new key keeps the credential.
2. Add two accounts; adjust priority and allowed models, disable one and clear its cooldown.
3. Complete OAuth, cancel it, and retry a consumed or expired callback; only a valid current
   administrator's callback should connect an account.
4. Request a supported text, image and tool-call flow in each enabled format, with and without
   streaming. Confirm cancellation and upstream failures produce a bounded response.
5. Request an unconfigured model name to exercise the default; enable tool compression and confirm saved characters
   appear in usage while IDs remain unchanged.
6. Check the allowed local inference endpoint and confirm unallowed private/metadata addresses
   and redirects are rejected.

The provider registry is intentionally small. Additional providers should be added and tested
as independent slices; this implementation does not clone 9Router's full provider catalog.
