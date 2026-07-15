# SkyBlockGPT repository instructions

These instructions apply to the entire repository. They are the default operating rules for Codex and other coding agents. Read `docs/PROJECT_CONTEXT.md` before making architectural or product-behavior changes, and use `docs/CHANGE_PLAYBOOK.md` for the file/test/deployment checklist.

## Mission

Maintain the public SkyBlockGPT Custom GPT and its compact Cloudflare gateway. The product answers player-specific and live-market questions from APIs, verifies item mechanics against the official Hypixel SkyBlock Wiki, and avoids inventing values when data is unavailable.

The project is public and globally used. Never hard-code a player identity, profile, API credential, or creator-only behavior. `AdamWarlock447` and `Mango` are examples in test prompts, not application defaults.

## Source-of-truth map

- `src/worker.js`: deployed Cloudflare Worker entry point (auth, CORS, route table); domain and route modules live in `src/*.js` and `src/routes/*.js`.
- `actions/hypixel-worker.openapi.json`: ChatGPT contract for the Worker.
- `actions/minecraft-username.openapi.json`: direct username-to-UUID Action.
- `actions/skycofl.openapi.json`: direct SkyCofl history/AH Action.
- `gpt/instructions.md`: production Custom GPT behavior; hard limit of 8,000 characters. Holds policy that must apply to every answer.
- `gpt/knowledge/*.md`: Custom GPT Knowledge uploads holding reference procedure (per-domain operations, formulas, market steps). Retrieved on demand, so never put a rule here that must fire on every answer. Uploaded content is user-extractable: never place a credential in these files.
- `gpt/config.md`: public name, description, conversation starters, capabilities, authentication, and privacy URLs.
- `scripts/test-worker.mjs`: mocked integration coverage for Worker behavior.
- `scripts/validate.mjs`: ChatGPT/OpenAPI compatibility checks.
- `wrangler.jsonc`: production Worker identity and deployment configuration.

Do not edit a generated release ZIP or treat it as source. Make changes in the files above.

## Non-negotiable product rules

1. Player and current Hypixel market data flows through the Worker, not directly from ChatGPT to `api.hypixel.net`.
2. Minecraft username resolution remains a separate public Minecraft Services Action.
3. SkyCofl remains a separate direct Action for history, sold auctions, and comparable AH evidence. Do not add its token to the Worker or repository.
4. Every item-specific GPT answer must verify the exact current item page on `hypixelskyblock.minecraft.wiki`. Live player NBT and prices come from Actions; item mechanics come from the wiki.
5. Missing, disabled, partial, or undecodable API data is unknown/unavailable—not zero and not evidence of a bad setup.
6. Never call a partial auction-page scan a global lowest BIN. Preserve exact item-ID/NBT comparability and expose scan completeness.
7. Keep responses compact and pageable. The Worker deliberately rejects JSON bodies over 80,000 characters to avoid ChatGPT connector failures.
8. Preserve the nonchalant, roast-heavy veteran-player personality: dismissive tone, complete substance. Nonchalance is never an excuse to shorten or hand-wave an answer. Roasts target builds, gear, and decisions—never the person. No personal attacks, no slurs, and no exception for third-party players the user looked up; the GPT is public and its audience skews young. The GPT never claims to be human. Accuracy wins over jokes. Public description text must end with `Made by GS`.
9. Use matched wiki images when useful, but never invent image URLs. Image selection is a GPT/web-search responsibility, not a Worker responsibility.
10. The public GPT asks for/resolves the current user's IGN. It must not assume cross-chat memory or silently use the creator's IGN.

## Security and privacy

- Never read, request, print, log, commit, or place credentials in schemas, instructions, fixtures, issues, or examples.
- Runtime Worker secrets are `HYPIXEL_API_KEY` and `GPT_SHARED_SECRET`.
- The Worker Action sends `GPT_SHARED_SECRET` as the custom `X-GPT-Key` header. Compare it without a plain string equality shortcut; preserve the digest-based comparison.
- GitHub deployment secrets are `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
- The direct SkyCofl Action stores its Bearer token in ChatGPT Action authentication.
- `.dev.vars`, `.env`, build output, and Wrangler state stay ignored.
- `/health` and `/privacy` are public. Every `/v1/*` Worker route requires `X-GPT-Key`.
- Do not weaken CORS/authentication or return upstream credentials in errors.

If a credential appears in user-provided material, do not copy it into a command, patch, test, or response. Use placeholder names only and recommend rotation if exposure is possible.

## Implementation constraints

- Runtime: Cloudflare Workers, JavaScript ES modules, Node.js 20+ for local tooling.
- Keep everything under `src/` dependency-free (local ES modules only) unless there is a strong reason to change the deployment model.
- Only `GET` and `OPTIONS` are currently supported.
- Validate and normalize all UUIDs, item tags, enums, booleans, pagination, and text lengths at the Worker boundary.
- Upstream requests need a timeout and normalized JSON errors. Respect `429`; do not implement retry storms.
- Player profiles are intentionally uncached. Static Hypixel resources may be cached. Do not persist player profile/inventory responses.
- Decode inventory NBT inside the Worker and return compact records. Avoid returning raw full profiles or unbounded NBT trees.
- Preserve the typed response conventions: `success`, useful `payload_kind` values, pagination metadata, `data_present`, and explicit completeness/availability indicators.
- Keep exact timestamps and units unambiguous. Existing Hypixel timestamps are Unix milliseconds.

## ChatGPT Action schema constraints

All Action changes must pass these current project limits:

- OpenAPI must be exactly `3.1.0`.
- At most 30 operations per Action document.
- Every operation has a unique, stable `operationId`.
- Operation descriptions are at most 300 characters.
- Parameters are inline and have string `name` fields; avoid shared parameter `$ref`s because ChatGPT has rejected them.
- Every array schema declares `items`.
- Internal schema references resolve.
- A domain may appear in only one Action set inside the GPT. Keep all Worker endpoints in the unified Worker schema.

Do not rename an operation, route, parameter, or response field casually. The GPT instructions may depend on those names, and any Action schema change requires a manual GPT Builder sync.

## Change procedure

Before editing:

1. Read the relevant handler, matching OpenAPI operation, existing test, and relevant GPT instruction together.
2. Decide whether the change affects Worker implementation, Action contract, GPT behavior, or more than one layer.
3. Preserve backward compatibility when possible so Worker-only fixes can deploy without a manual GPT update.

While editing:

- Update implementation and contract in the same change when the HTTP interface changes.
- Add focused mocked integration assertions for bug fixes and new behavior.
- Keep schemas compact; expose filters/pagination instead of giant result sets.
- Update `gpt/instructions.md` only for behavior the model must know. Keep reference material in docs rather than consuming the 8,000-character instruction budget.
- Split rule for GPT content: policy and invariants go in `gpt/instructions.md` because they are always in context; reference procedure goes in `gpt/knowledge/*.md` because it is only retrieved when a query matches. When a procedure moves to Knowledge, its safety invariant stays in the instructions. Every Knowledge file must be referenced by name from the instructions, and `scripts/validate.mjs` enforces that both ways.
- Update `docs/PROJECT_CONTEXT.md` when architecture, providers, secrets, endpoints, or durable product requirements change.

Required verification:

```bash
npm install
npm test
npm run deploy:dry
```

Use `npm ci` in clean/CI environments. Do not deploy code that fails either schema validation or mocked Worker integration tests.

## Deployment and GPT synchronization

- A merge/push to `main` that changes Worker/deployment files triggers `.github/workflows/deploy-worker.yml`.
- Production Worker name: `skyblock-gpt-proxy`.
- Production base URL: `https://skyblock-gpt-proxy.girishsonic8.workers.dev`.
- Worker changes that keep the Action contract stable require no GPT edit.
- Changes under `actions/` or `gpt/` require a manual edit in the ChatGPT web GPT Builder followed by Preview tests and **Update**. There is no supported automated Custom GPT configuration update in this repository.
- A change under `gpt/knowledge/` requires re-uploading that file in GPT Builder's Knowledge section, replacing the old copy. A stale Knowledge file fails silently: the GPT retrieves outdated procedure and reports no error. Re-upload every changed file before pressing **Update**.
- Do not create a second Worker Action set: ChatGPT rejects duplicate domains. Replace the schema in the existing Worker Action.
- After a production change, test `/health` and one narrow authenticated route without exposing the header in public logs.

## Completion standard

A change is complete only when implementation, schema, tests, GPT instructions/config, and durable docs agree; all relevant tests pass; no secret is present; connector response size remains bounded; and the handoff clearly says whether Cloudflare deployed automatically and whether a manual GPT Builder update is required.
