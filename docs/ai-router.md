# AI router

DevOne has a built-in AI model router, modelled on [9router](https://github.com/decolua/9router).
It gives every tool one OpenAI-compatible endpoint. Behind that endpoint, it sends each request to
the first provider that answers. A provider that is rate-limited, out of quota, refuses its key or
is down hands the request to the next one. It works with free tiers (OpenCode Zen's Big Pickle,
OpenRouter `:free` models, Groq, Gemini, Cerebras), paid APIs and local Ollama models alike.

```
OpenCode / Cursor / Cline / curl / DevOne
        │  POST /api/ai/v1/chat/completions   (Bearer dvo_…)
        ▼
   DevOne AI router ──► provider 1 (429, rate-limited) ✗
                    ──► provider 2 (answers) ✓ ──► streamed back as it arrives
```

## Set it up

1. **Admin → AI router → Add provider.** Start from a preset (OpenCode Zen, OpenRouter, Groq,
   Gemini, Cerebras, Mistral, DeepSeek, Ollama) or enter any OpenAI-compatible base URL. Paste
   the API key, then use **Fetch models** to list the provider's models, or type them one per
   line. Keys are encrypted with `DEVONE_ENCRYPTION_KEY` and never shown again.
2. **Optional: add a combo.** A combo is a model name, such as `free-stack`, that stands for an
   ordered list of provider models. Put free models first and paid ones last.
3. **My account → AI keys → Create key.** The key (`dvo_…`) is shown once. Each person makes their
   own key, so usage is per person and a key can be deleted without affecting anyone else.
4. Point a tool at the endpoint shown there (`https://your-devone/api/ai/v1`) with that key.

Requests from DevOne itself, made from a signed-in browser on the same site, need no key.

## Which model to ask for

| `model` | Goes to |
| --- | --- |
| `free-stack` (a combo's name) | The combo's steps, in order |
| `auto` | Every enabled provider's first model, lowest priority number first |
| `big-pickle` (a plain model name) | Every enabled provider that lists it, lowest priority number first |
| `OpenCode Zen/big-pickle` (provider name, a slash, the model) | Only that provider. The model does not have to be in its list |

`GET /api/ai/v1/models` lists them all.

## Fallback rules

- **Moves on** after a network error, no answer within 60 seconds, or HTTP 401, 402, 403, 404,
  408, 409, 429 or any 5xx.
- **Returns at once** after 400, 413 or 422: a malformed request fails the same everywhere.
- **Cooldowns:** a failing provider rests for a while and is tried last until then. A 429 rests
  for its `Retry-After` time (one minute if not given, an hour at most). A refused key rests
  10 minutes; an outage or timeout, 30 seconds. **Try again now** on the provider clears it, and so
  does its next successful answer.
- Once a provider starts answering, the answer streams straight through. Fallback only happens
  before the first byte.

Responses carry `x-devone-provider`, `x-devone-model` and `x-devone-attempts` headers, so you
can see which provider answered.

## Usage and limits

Admin → AI router → Usage shows each request: who made it, the model asked for and the one that
answered, the number of tries, the status and the token counts. Streamed requests ask the provider
for `stream_options.include_usage`, so they report tokens too. Each person can make
`DEVONE_AI_RATE_LIMIT` requests a minute (default 60; `0` turns the limit off), so one busy client
cannot use up a shared free quota. The AI router is off in the public demo
(`DEVONE_DEMO_MODE`).

## Using it from tools

**curl**

```bash
curl https://your-devone/api/ai/v1/chat/completions \
  -H "Authorization: Bearer $DEVONE_AI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'
```

**OpenCode** (`opencode.json`)

```json
{
  "provider": {
    "devone": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DevOne",
      "options": { "baseURL": "https://your-devone/api/ai/v1", "apiKey": "{env:DEVONE_AI_KEY}" },
      "models": { "free-stack": {}, "auto": {} }
    }
  }
}
```

**Claude Code** speaks Anthropic's Messages API, which the router translates to chat completions
and back (text, images, tools, streaming). Point it at the router and pick a model it can serve:

```bash
export ANTHROPIC_BASE_URL=https://your-devone/api/ai   # Claude Code adds /v1/messages
export ANTHROPIC_AUTH_TOKEN=$DEVONE_AI_KEY
export ANTHROPIC_MODEL=free-stack                       # a combo, "auto" or a model name
claude
```

Claude Code also asks for `claude-…` model names for its helper tasks. Set a **Default model** in
Admin → AI router → Settings and any name nothing serves goes there.

**Cursor, Cline, Continue and other tools:** pick the OpenAI-compatible provider, set the base URL
and key, and enter `auto` or a combo as the model.

## Shrinking tool output

Agents send long command logs, listings and diffs back to the model with every turn. With
**Shrink tool output** on (Settings), the router strips colour codes and trailing spaces, folds
repeated lines and blank runs, and keeps only the beginning and end of anything longer than the
limit (30,000 characters by default). The characters saved are recorded per request. Send the
header `x-devone-token-saver: off` to skip it for one request.

## Things to know

- **Free models come with conditions.** OpenCode Zen's free models (Big Pickle and others) and
  other free tiers can log prompts, use them for training, change or disappear. Read each
  provider's terms before sending them private code.
- **Only real API keys.** 9router can also reuse the logins of paid subscriptions (Claude Code,
  Codex, Copilot). DevOne leaves that out: it is usually against those services' terms.
- **Providers speak OpenAI chat format.** Providers must offer `POST /chat/completions`. Clients
  can use either that or Anthropic's `/v1/messages`; the router translates. Anthropic-only
  features without an OpenAI equivalent (extended thinking, prompt caching markers) are dropped.
- **Provider URLs.** Local and private addresses work (Ollama, LM Studio), but link-local and
  reserved ones, such as the cloud metadata address 169.254.169.254, are refused when saving.
- **One server process.** The rate limit is kept in memory, so it is per DevOne process and resets
  on restart.

## Code

| Path | What it does |
| --- | --- |
| `src/lib/ai-router/routing.ts` | Picks and orders the providers to try, decides when to fall back and for how long to rest a provider, reads token usage (pure functions) |
| `src/lib/ai-router/anthropic.ts` | Anthropic Messages ⇄ chat completions, whole and streamed |
| `src/lib/ai-router/compress.ts` | Tool output shrinking |
| `src/lib/ai-router/safe-url.ts` | Refuses metadata and reserved provider addresses |
| `src/lib/ai-router/forward.ts` | Tries each provider in turn, relays streams and reports the outcome |
| `src/lib/ai-router/presets.ts` | The presets in the Add provider form |
| `src/features/ai-router/` | Database service, server actions, admin and account screens |
| `src/app/api/ai/v1/` | The `chat/completions`, `messages`, `messages/count_tokens` and `models` endpoints |
| `scripts/check-core.ts` | Checks for routing, fallback, streaming, keys and the rate limit |
