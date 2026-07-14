# Change playbook

Use this file after reading `AGENTS.md` and `docs/PROJECT_CONTEXT.md`.

## Quick change matrix

| Change | Worker | Worker OpenAPI | Worker tests | GPT instructions/config | Manual GPT update | Auto-deploy after merge |
|---|---:|---:|---:|---:|---:|---:|
| Internal bug fix with unchanged response contract | Yes | No | Yes | Usually no | No | Yes |
| Add/change route, parameter, operation, or response field | Yes | Yes | Yes | Usually | Yes | Yes |
| Change interpretation/calling strategy only | No | Maybe | Maybe | Yes | Yes | No |
| Change description/starters/auth notes | No | No | No | `gpt/config.md` | Yes | No |
| Change username lookup | Maybe | Username schema | Relevant test/validation | Maybe | Yes | Only if Worker also changed |
| Change SkyCofl operations | No | SkyCofl schema | Validation/contract fixture | Yes | Yes | No |
| Change Cloudflare deployment | Maybe | No | CI/dry-run | No | No | Workflow-dependent |

## Worker bug fix without an API change

1. Reproduce with a focused mocked case in `scripts/test-worker.mjs`.
2. Fix the relevant module under `src/` while keeping route, parameter, operation ID, and response shape compatible.
3. Run `npm test` and `npm run deploy:dry`.
4. Merge to `main`; the Worker deploy workflow runs automatically.
5. Verify `/health` and the narrow route. No GPT Builder update should be necessary.

Prefer this path. Stable contracts are what make routine updates automatable.

## Add or change a Worker endpoint

1. Design a compact/filterable response. Do not expose a raw full Hypixel payload.
2. Add or update the handler in the matching `src/routes/*.js` file and register the path in the `ROUTES` map in `src/worker.js`.
3. Update `actions/hypixel-worker.openapi.json` in the same change.
4. Keep the operation ID stable for modifications; use a descriptive unique ID for a new operation.
5. Add mocked success, validation, auth, empty/missing-data, pagination, and relevant upstream-error assertions.
6. Update `gpt/instructions.md` if the model needs to know when/how to call it or interpret its fields.
7. Update the endpoint table and durable semantics in `docs/PROJECT_CONTEXT.md`.
8. Update both Worker version strings when behavior/contract meaningfully changes.
9. Run:

   ```bash
   npm test
   npm run deploy:dry
   ```

10. After merge, wait for Worker deployment, then replace the schema in the existing Worker Action set and click **Update** in GPT Builder.

Do not create another Action set for the same Worker domain.

## Add a new profile section

1. Add the section name to `PROFILE_SECTIONS` in `src/sections.js`.
2. Implement its compact builder under `buildSection` in `src/sections.js`.
3. Decide and document availability semantics; never substitute zero for missing data.
4. Update the `section` parameter enum and response schema in the Worker OpenAPI document.
5. Add representative API-enabled, missing, and partial fixtures to the Worker test.
6. Add a short calling rule to `gpt/instructions.md` only if necessary.

For large lists, prefer a dedicated typed/pageable endpoint instead of overloading the generic section route. Accessories and Collections already follow this pattern.

## Inventory or NBT change

1. Preserve the index -> container -> item-detail flow.
2. Use bounded depth/entry counts when expanding NBT.
3. Preserve original item ID, count, slot, clean name, relevant modifiers, and decode status.
4. Add a compressed fixture that exercises the exact bug/format.
5. Do not expose all containers or raw trees in one response.

## Bazaar or auction change

1. Keep exact product/item IDs separate from display names.
2. Preserve timestamps and explicitly name buy/sell/order/offer fields.
3. For lowest BIN, sort comparable BINs ascending and preserve scan completeness/page limits.
4. Never declare a page-local price authoritative.
5. Test non-BIN filtering, exact item matching, ordering, pagination, and incomplete scans.
6. Keep historical series in the direct SkyCofl Action; do not add SkyCofl credentials to the Worker.

## GPT instruction update

1. Edit `gpt/instructions.md`.
2. Keep rules direct and operational; move background/reference prose to `docs/`.
3. Run `npm run validate` and confirm the printed character count is below 8,000.
4. Paste the complete file into GPT Builder Instructions.
5. Preview the affected call/answer behavior.
6. Click **Update** and test again in a fresh chat.

## Action-schema-only update

1. Change only the relevant schema.
2. Run `npm run validate`.
3. Open the existing Action set in GPT Builder and replace its schema.
4. Do not add a new Action with the same domain.
5. Confirm authentication from `gpt/config.md`; never put a token inside JSON.
6. Preview at least one changed operation, then click **Update**.

## Security or secret rotation

Do not commit secret values.

- Hypixel: `npx wrangler secret put HYPIXEL_API_KEY`
- Shared Worker/GPT header: `npx wrangler secret put GPT_SHARED_SECRET`, then update the existing Worker Action credential.
- Cloudflare CI: replace the GitHub repository secret `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID`.
- SkyCofl: replace Bearer authentication in the direct SkyCofl Action.

After rotation, use narrow private verification. Never paste an authenticated curl command into an issue or public log.

## Release

1. Update `package.json` version and lockfile metadata if needed.
2. Run the full verification suite.
3. Merge the release change.
4. Tag the exact commit with `v<version>` and push the tag.
5. The release workflow validates and attaches the clean ZIP.

## Agent handoff template

Every coding-agent completion should report:

- What behavior changed.
- Files changed.
- Tests/dry-run executed and their result.
- Whether merging to `main` deploys the Worker.
- Whether `actions/` or `gpt/` changed and therefore requires a manual GPT Builder update.
- Any remaining limitation, partial scan, source uncertainty, or secret/configuration step.
