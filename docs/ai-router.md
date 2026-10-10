# AI gateway

DevOne exposes one gateway at `https://your-devone/api/ai/v1`, building on the routing approach
in [9Router](https://github.com/decolua/9router). Providers define the upstream API and model
names; accounts hold encrypted credentials and have independent priority, allowed models,
expiry and cooldown. Existing provider keys, gateway keys and combos keep working.

## Set it up

1. For Claude OAuth, open **Admin → AI router → Provider accounts → Add connection → Claude**.
   Selecting Claude starts sign-in immediately, creating or reusing its provider definition.
   Approve access on the provider's page; the callback saves an encrypted account. **Add account**
   on an OAuth provider also starts sign-in directly. Selecting Claude or Codex in **Add provider**
   starts the same flow. A configured OAuth client is required.
2. For other providers, open **Add provider**. Choose a preset, upstream format and
   authentication mode. Use **Fetch models**, or enter model IDs one per line. Discovery is
   provider-dependent; manual model entry works when an upstream has no model-list endpoint.
3. For API-key or access-token authentication, enter the credential in the provider form or
   **Provider accounts → Add account**. Add more accounts to the same provider when needed.
   Empty credentials keep the saved value during editing. Disable or remove an account to stop
   routing through it. Credential values are encrypted with `DEVONE_ENCRYPTION_KEY` and never
   returned to the browser after saving.
4. For custom OAuth providers, save the provider and use **Add account**, or **Save and connect**.
   Each authorization creates an account. Your installation must have its own configured OAuth
   application. Reconnect after revocation or when refresh is no longer available.
5. Optionally create a **combo**, an ordered list of provider/model pairs such as `free-stack`.
6. Under **Router settings**, set a default model and optionally shorten large tool results.
7. Open **My account → AI keys → Create key**. Copy the `dvo_…` key when shown; it cannot be
   displayed again. Each person has independent gateway keys and usage.
8. Configure your tool with the gateway base URL and personal gateway key.

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
that your configured endpoint supports. No third-party application's client ID or first-party
client identity is built into the OAuth flow.

## OAuth installation configuration

Set `DEVONE_APP_URL` to the public HTTPS address of DevOne. Register the exact callback URL
`https://your-devone/api/ai/oauth/<provider-record-id>/callback` with your OAuth application;
the ID belongs to the saved provider record, not the preset name. Use an OAuth application and
scopes that the upstream supports for your installation.

For a client registered with a loopback `/callback` address, set
`DEVONE_AI_CLAUDE_REDIRECT_URI=http://localhost:3000/callback` (adjust to your app address).
The override must have the same origin as `DEVONE_APP_URL` and use `/callback` or the provider's
normal callback path. Start sign-in from that same app address so its session cookie is present
when authorization returns. The shared callback resolves the provider from the saved state;
the browser does not choose which account receives the authorization code.

Claude and Codex configuration use these prefixes:

```dotenv
DEVONE_AI_CLAUDE_CLIENT_ID=your-registered-client-id
DEVONE_AI_CLAUDE_CLIENT_SECRET=
DEVONE_AI_CODEX_CLIENT_ID=your-registered-client-id
DEVONE_AI_CODEX_CLIENT_SECRET=
```

Each prefix accepts `AUTHORIZE_URL`, `TOKEN_URL`, `SCOPE`, `TOKEN_ENCODING` (`form` or `json`)
and `REFRESH_LEAD_MS`. Claude and Codex have default authorization/token endpoints and scopes;
override them to match your registered application. An OAuth client ID is required. Configure
`CLIENT_SECRET` only when your application requires it.

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
and saved encrypted. A missing installation configuration is shown in the UI as OAuth being
unavailable.

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

Responses expose `x-devone-provider`, `x-devone-model` and `x-devone-attempts`. **Admin → AI router
→ Usage** shows recent requests, token counts, attempts, status and saved characters from tool
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

Confirm the provider and primary account appear under **Admin → AI router**, then make a test
request using an existing gateway key before adding OAuth accounts.

## Verification

Run the repository's AI protocol, OAuth and gateway checks alongside typecheck, lint and build.
They use controlled test transports; real-provider validation still requires real credentials,
a reachable upstream and an installed OAuth application.

`bun run test:ai:db` also checks provider creation and concurrent credential locks against the
configured, migrated PostgreSQL database. It removes only the temporary records it creates.
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
