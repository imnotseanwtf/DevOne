# Local Codex setup

Use the existing branch, encrypted OAuth accounts, and connection test chat. Match 9Router's native Codex authorization parameters and callback at `http://localhost:1455/auth/callback`. Preserve Claude/custom OAuth. The user completes external sign-in; do not import the coding agent's cached credentials.

1. Add failing checks for current models/authorization parameters, validated callback relay, account-aware model discovery, and native Responses transport. Use the existing AI check scripts and a focused loopback socket check.
2. Implement `createCodexLoopbackServer(appUrl, lookupSession): Server` and `ensureCodexLoopbackListener(appUrl): Promise<void>` in the feature module. Validate saved state, expiry, provider type, host, and fixed callback URI before redirecting to the existing authenticated callback. Bind localhost only, keep a ten-minute listener lease, and report a busy port without touching other processes.
3. Configure the ignored local env with the public Codex client ID and callback. Add the 9Router authorization parameters, current bootstrap text models, and model discovery through `/models?client_version=...` using account headers. Refresh continues preserving configured defaults/accounts.
4. Match required Codex headers and Responses Lite preparation for the models marked by the registry; keep existing parameter validation and caller data intact.
5. Run focused/full checks, typecheck, scoped lint, production build, and browser navigation/callback checks. Verify real inference if the user completes sign-in during setup. Commit on the current branch and leave the local app running.

Review focus: expired/unknown/replayed state; wrong-provider callback; remote callback and hostile Host values; occupied port 1455; image-only model entries; Responses Lite preserving instructions/tools without mutating input. Each boundary receives a focused regression check.
