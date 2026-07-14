# Claude Code project instructions

Read and follow `AGENTS.md` before changing this repository. It is the authoritative repository-wide instruction file. Then read:

1. `docs/PROJECT_CONTEXT.md` for the product, architecture, trust boundaries, endpoint map, and known platform limits.
2. `docs/CHANGE_PLAYBOOK.md` for the exact files, tests, deployment effects, and Custom GPT synchronization steps for each change type.

Critical reminders:

- Never commit or display API keys, Action credentials, `.dev.vars`, or authentication headers.
- Do not hard-code `AdamWarlock447`, `Mango`, or any other player as a default; this is a public GPT.
- Keep the Worker response compact and pageable, and treat missing API data as unavailable rather than zero.
- Preserve existing routes/operation IDs when possible so Worker fixes do not require a manual GPT update.
- Every HTTP contract change must update the Worker, the matching OpenAPI schema, tests, and any affected GPT instructions together.
- Run `npm test` and `npm run deploy:dry` before considering work complete.
- State explicitly in the final handoff whether the change auto-deploys the Worker and whether the owner must manually update the Custom GPT.

Do not use browser automation or ChatGPT session cookies to update the public GPT. GPT Builder synchronization is intentionally manual.
