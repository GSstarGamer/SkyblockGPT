# Worker restructure design (2026-07-14)

## Goal

Split the single-file Cloudflare Worker (`src/worker.js`, 2,972 lines, ~90 functions) into focused ES modules. Organization only: zero behavior, contract, or performance change. Wrangler bundles local ES modules natively, so the deployment model and the dependency-free constraint are preserved.

## Non-goals

- No runtime optimization, caching changes, or upstream-call changes.
- No route, parameter, operation ID, response-shape, error-text, or status-code changes.
- No bug fixes. Bugs discovered while moving code are reported in the handoff, not fixed.
- No framework or npm runtime dependency.
- No version bump: the Worker contract and behavior are unchanged, so `UPSTREAM_USER_AGENT` and the `/health` version stay `2.5.0`.

## Module layout

```
src/
  worker.js     entry: export default fetch, ROUTES map, CORS/OPTIONS,
                method check, /health, /privacy, secret checks
  http.js       json(), privacyPolicy(), ClientError, UpstreamError
  params.js     UUID/item-tag patterns and all query validators
  hypixel.js    upstream fetch, timeout, memory cache, resource fetchers
  profiles.js   profile selection, member access, overview builder
  sections.js   PROFILE_SECTIONS, buildSection, per-section builders
  items.js      NBT container discovery, inventory blob decode,
                item compaction, gear, accessories
  nbt.js        NbtReader class, base64, gzip parsing primitives
  market.js     bazaar/auction compactors and comparators
  util.js       generic helpers (pick, sanitize, round, pagination, batching)
  routes/
    player.js     7 player handlers
    inventory.js  3 inventory handlers
    market.js     6 bazaar/auction handlers
    misc.js       resources + feed handlers
```

`src/worker.js` remains the Wrangler `main` and keeps `export default { fetch }`, so `wrangler.jsonc` and the `scripts/test-worker.mjs` import path do not change.

## Dependency direction (no cycles)

- `util.js`, `http.js`, `nbt.js`: leaf modules, import nothing.
- `params.js` → `http.js` (validators throw `ClientError`).
- `hypixel.js` → `http.js`.
- `items.js` → `nbt.js`, `util.js`.
- `sections.js` → `items.js`, `params.js`, `util.js` (`compactMuseum`/`compactPlayerCollections` use `normalizeUuid`).
- `market.js` → `items.js`, `util.js` (`compactAuction` decodes `item_bytes` via `decodeInventoryBlob` from `items.js`).
- `profiles.js` → `hypixel.js`, `params.js`, `util.js`.
- `routes/*.js` → any of the above.
- `worker.js` → `routes/*.js`, `http.js`.

## Function placement

| Module | Contents (from current `src/worker.js`) |
|---|---|
| `worker.js` | default export `fetch`, route table, `secretsMatch` |
| `http.js` | `json`, `privacyPolicy`, `ClientError`, `UpstreamError` |
| `params.js` | `UUID_PATTERN`, `GENERIC_UUID_PATTERN`, `ITEM_TAG_PATTERN`, `readIntegerParameter`, `readTextParameter`, `requireEnumParameter`, `readOptionalBooleanParameter`, `readDetailParameter`, `requireItemTag`, `requireUuid`, `requireContainerId`, `normalizeUuid`, `cleanSelector` |
| `hypixel.js` | `UPSTREAM_USER_AGENT`, `fetchHypixelJson`, `fetchJsonUpstream`, `getMemoryCache`, `setMemoryCache`, `fetchSkyBlockItemNameMap`, `fetchCollectionResource`, `fetchSkillResource`, `fetchProfiles` |
| `profiles.js` | `selectProfile`, `compactProfile`, `getMember`, `isDeleted`, `loadSelectedMember` |
| `sections.js` | `PROFILE_SECTIONS`, `buildSection`, `buildOverview`, `compactSkills`, `collectSkillExperience`, `normalizeSkillName`, `calculateSkillProgress`, `emptySkillProgress`, `compactMining`, `compactForge`, `isForgeProcess`, `compactForgeProcess`, `compactForaging`, `compactTreePerks`, `formatTreePerkName`, `compactPowder`, `compactStats`, `filterNumericStats`, `readTreeScopedValue`, `compactSlayers`, `compactDungeons`, `compactPets`, `compactGarden`, `compactMuseum`, `flattenCollections`, `compactPlayerCollections`, `compactCollectionTier`, `collectionUnlockText`, `compactCollectionItem` |
| `items.js` | `decodeInventoryBlob`, `findNbtContainers`, `findSacksCounts`, `isNbtBlob`, `containerMetadata`, `inventoryContainerKind`, `inventoryContainerLabel`, `compactGear`, `compactAccessories`, `compactNbtItem`, `expandNbtItem`, `inferArmorSlot`, `inferEquipmentCategory`, `cleanItemName`, `flattenTextComponent`, `formatItemId` |
| `nbt.js` | `NbtReader`, `decodeBase64`, `decompressGzip` (all three exported; consumed by `decodeInventoryBlob` in `items.js`) |
| `market.js` | `compactBazaarProduct`, `compareBazaarProducts`, `compactAuction`, `compactEndedAuction`, `auctionPrice`, `binPrice`, `resolveSkyBlockItem`, `normalizeItemSearchText`, `skyBlockItemIdsMatch` |
| `util.js` | `pick`, `sanitize`, `number`, `optionalNumber`, `firstNumber`, `round`, `objectOrEmpty`, `stringOrNull`, `paginateRecords`, `mapInBatches`, `normalizeUnixMilliseconds`, `isoFromUnixMs` |
| `routes/player.js` | `handleProfiles`, `handleSummary`, `handleSection`, `handlePlayerCollections`, `handlePlayerAccessories`, `handleSacks`, `handlePlayerExtra`, `compareSackItems`, `EXTRA_KINDS` |
| `routes/inventory.js` | `handleInventoryIndex`, `handleInventoryContainer`, `handleInventoryItem` |
| `routes/market.js` | `handleBazaarProducts`, `handleBazaarProduct`, `handleAuctionPage`, `handleLowestBin`, `handleAuctionLookup`, `handleEndedAuctions` |
| `routes/misc.js` | `handleResources`, `handleFeed`, `RESOURCE_KINDS`, `FEED_KINDS`, `compactResourceItem`, `resourceRecordMatches` |

Placement rule for small helpers: a helper consumed by exactly one handler file lives in that handler file; shared builders live in their domain module. If implementation reveals a helper listed above is used more widely (or only once), it moves to match this rule — usage, not this table, is authoritative for tiny helpers. Behavior is unaffected either way.

**Amendment (Task 3 discovery, 2026-07-14):** `decodeInventoryBlob` calls `compactNbtItem` directly, so the two must share a module to keep the graph acyclic. `decodeInventoryBlob` therefore lives in `items.js`, not `nbt.js`; `nbt.js` stays a pure parsing leaf and exports `NbtReader`, `decodeBase64`, `decompressGzip` to `items.js`. `market.js` and route files consume `decodeInventoryBlob` from `items.js`.

**Amendment (Task 7 discovery, 2026-07-14):** `buildSection`'s `"overview"` case calls `buildOverview`, so placing `buildOverview` in `profiles.js` would create a `sections.js ⇄ profiles.js` cycle. `buildOverview` therefore lives in `sections.js` (exported); `profiles.js` no longer depends on `sections.js`. `sections.js` additionally imports `normalizeUuid` from `params.js`.

## Behavior invariants

- Request lifecycle order is byte-identical: OPTIONS/CORS response → method check → `/health` → `/privacy` → secret-presence check → digest-based `X-GPT-Key` comparison → route dispatch → 404 fallback → single try/catch mapping `ClientError`/`UpstreamError` status and message.
- The 18-branch if-chain becomes an exact-match `Map` from pathname to handler. Paths are exact strings today, so lookup is order-independent and produces identical routing, including the 404 fallback.
- Code moves verbatim. The only new lines are `import`/`export` statements. No renames, no signature changes, no logic edits.
- Digest-based secret comparison is preserved exactly (AGENTS.md security requirement).

## Tooling and docs updated in the same change

| File | Change |
|---|---|
| `scripts/package-release.mjs` | Copy the `src/` directory into the release ZIP as `cloudflare-worker/` (recursive `cpSync`) instead of the single-file copy. |
| `scripts/validate.mjs` | Run `node --check` on every `src/**/*.js` file instead of only `src/worker.js`. |
| `README.md` | Update the file-tree line for `src/`. |
| `AGENTS.md` | Source-of-truth map: `src/worker.js` entry → `src/` modules; reword "Keep `src/worker.js` dependency-free" to cover `src/`. |
| `docs/CHANGE_PLAYBOOK.md` | Point `src/worker.js` fix/edit steps at the relevant module under `src/`; `PROFILE_SECTIONS`/`buildSection` references now name `src/sections.js`. |

Not changed: `wrangler.jsonc` (`main` still `src/worker.js`), `scripts/test-worker.mjs` (import path stable), `.github/workflows/deploy-worker.yml` (already triggers on `src/**`), all `actions/` schemas, all `gpt/` files.

## Error handling

Unchanged. `ClientError` and `UpstreamError` move to `http.js`; every module that throws imports them from there. The single top-level try/catch in `worker.js` continues to convert them to the existing JSON error envelope.

## Testing and verification

- The mocked integration suite (`scripts/test-worker.mjs`) is the behavioral safety net. It imports the default export from `src/worker.js` and stubs `globalThis.fetch`, so it runs unmodified against the restructured Worker.
- Required before completion: `npm test` (validate + worker suite) and `npm run deploy:dry` (proves the Wrangler bundle resolves every module import).
- No new tests are required for a verbatim move; any test addition would indicate a behavior change, which is out of scope.

## Deployment and handoff

- Merging to `main` auto-deploys the Worker (`src/**` path trigger).
- No `actions/` or `gpt/` files change, so no manual GPT Builder update is required.
- Handoff must state: behavior unchanged, auto-deploy yes, manual GPT sync no.
