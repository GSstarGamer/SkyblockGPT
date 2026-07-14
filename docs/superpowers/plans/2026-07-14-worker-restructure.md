# Worker Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `src/worker.js` (2,972 lines) into 14 focused ES modules with zero behavior, contract, or performance change.

**Architecture:** Extract leaf modules first (util, http, nbt), then domain modules (params, hypixel, items, sections, market, profiles), then route handlers, then slim the entry to a route table. Every task leaves the Worker importable and the full test suite green, so any commit is deployable. Wrangler bundles local ES modules natively; `src/worker.js` stays the `main` entry with `export default { fetch }`.

**Tech Stack:** Cloudflare Workers, plain JavaScript ES modules, no npm runtime dependencies, Node 20+ tooling, Wrangler 4.

**Spec:** `docs/superpowers/specs/2026-07-14-worker-restructure-design.md` (commit `4a28139`). The spec's function-placement table is authoritative.

## Global Constraints

- Code moves **verbatim**: no renames, no signature changes, no logic edits, no formatting churn beyond adding `export` keywords and `import` lines.
- Zero HTTP contract change: routes, params, response JSON, error text, status codes, headers, and request lifecycle order stay byte-identical.
- Version strings stay `2.5.0` (`UPSTREAM_USER_AGENT` and the `/health` payload). No `package.json` version bump.
- `wrangler.jsonc` and `scripts/test-worker.mjs` are **not modified**.
- The digest-based `secretsMatch` comparison stays in `src/worker.js`, unchanged (AGENTS.md security rule).
- No new npm dependencies. No new tests (a test addition would signal a behavior change — out of scope).
- Bugs discovered while moving code are noted in the final handoff, **not** fixed.
- Line ranges below refer to the original `src/worker.js` at commit `4a28139` and drift as tasks delete code. **Locate functions by name**; ranges are hints only.
- Export rule: prepend `export` only to declarations another file imports. Helpers used solely inside their new module stay unexported. If `npm test` fails with a ReferenceError, add the missing import from the module the spec's placement table assigns — never duplicate a function.
- After each extraction, remove imports in `src/worker.js` that no longer have any remaining usage in that file.
- Run after every task: `npm test && npm run deploy:dry`. Expected: validate prints a `{"success":true,...}` JSON line, the worker suite passes, and Wrangler prints `--dry-run: exiting now` with a Total Upload size. Exit code 0.
- Commit after every task with the exact message given. All commits end with the trailer line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Extract `src/util.js`

**Files:**
- Create: `src/util.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: nothing (leaf module, zero imports).
- Produces: `export function pick(object, keys)`, `sanitize(value, depth = 5, maxEntries = 300)`, `number(value)`, `optionalNumber(value)`, `firstNumber(...values)`, `round(value, digits = 2)`, `objectOrEmpty(value)`, `stringOrNull(value)`, `paginateRecords(records, page, limit)`, `mapInBatches(values, batchSize, mapper)` (async), `normalizeUnixMilliseconds(value)`, `isoFromUnixMs(value)`.

- [ ] **Step 1: Create `src/util.js`** — cut these functions out of `src/worker.js` verbatim and paste them into the new file, prepending `export` to each: `mapInBatches` (1336–1343), `paginateRecords` (1409–1421), `normalizeUnixMilliseconds` (2038–2043), `isoFromUnixMs` (2044–2053), `objectOrEmpty` (2227–2230), `firstNumber` (2237–2244), `round` (2245–2249), `stringOrNull` (2667–2670), `pick` (2856–2863), `sanitize` (2864–2882), `optionalNumber` (2883–2888), `number` (2889–2892). The file has no imports.

- [ ] **Step 2: Wire `src/worker.js`** — add at the top of the file:

```js
import {
  firstNumber,
  isoFromUnixMs,
  mapInBatches,
  normalizeUnixMilliseconds,
  number,
  objectOrEmpty,
  optionalNumber,
  paginateRecords,
  pick,
  round,
  sanitize,
  stringOrNull,
} from "./util.js";
```

- [ ] **Step 3: Verify** — Run: `node --check src/util.js && npm test && npm run deploy:dry`. Expected: exit 0, worker suite green, dry-run bundle succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/util.js src/worker.js
git commit -m "refactor(worker): extract util module" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Extract `src/http.js`

**Files:**
- Create: `src/http.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `export function json(payload, status = 200)`, `export function privacyPolicy()`, `export class ClientError extends Error`, `export class UpstreamError extends Error`.

- [ ] **Step 1: Create `src/http.js`** — move verbatim, prepending `export`: `json` (2907–2931), `privacyPolicy` (2932–2959), `ClientError` (2960–2966), `UpstreamError` (2967–2971). No imports.

- [ ] **Step 2: Wire `src/worker.js`** — add:

```js
import { ClientError, json, privacyPolicy, UpstreamError } from "./http.js";
```

- [ ] **Step 3: Verify** — Run: `node --check src/http.js && npm test && npm run deploy:dry`. Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/http.js src/worker.js
git commit -m "refactor(worker): extract http module" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract `src/nbt.js`

**Files:**
- Create: `src/nbt.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: nothing (uses only web platform APIs: `atob`, `DecompressionStream`, `DataView`).
- Produces: `export class NbtReader`, `export function decodeBase64(value)`, `export async function decompressGzip(bytes)`. **`decodeInventoryBlob` does NOT move in this task** — it calls `compactNbtItem` (Task 6 material), so it stays in `src/worker.js` until Task 6 moves both into `src/items.js` together (see the spec's Task 3 amendment).

- [ ] **Step 1: Create `src/nbt.js`** — move verbatim, prepending `export` to all three: `decodeBase64` (2533–2543), `decompressGzip` (2544–2555), `class NbtReader` (2671–2829). No imports.

- [ ] **Step 2: Wire `src/worker.js`** — add:

```js
import { decodeBase64, decompressGzip, NbtReader } from "./nbt.js";
```

(`decodeInventoryBlob`, still in `src/worker.js`, now resolves those three names through this import.)

- [ ] **Step 3: Verify** — Run: `node --check src/nbt.js && npm test && npm run deploy:dry`. Expected: exit 0. The worker suite exercises NBT decode via the `talisman_bag` fixture, so a broken move fails here.

- [ ] **Step 4: Commit**

```bash
git add src/nbt.js src/worker.js
git commit -m "refactor(worker): extract nbt module" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Extract `src/params.js`

**Files:**
- Create: `src/params.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: `ClientError` from `./http.js`.
- Produces: `export const UUID_PATTERN`, `GENERIC_UUID_PATTERN`, `ITEM_TAG_PATTERN`; `export function requireContainerId(url)`, `readIntegerParameter(url, name, fallback, minimum, maximum)`, `readTextParameter(url, name, maximum, fallback = "")`, `requireEnumParameter(url, name, allowed, fallback = null)`, `readOptionalBooleanParameter(url, name)`, `readDetailParameter(url)`, `requireItemTag(url, name)`, `requireUuid(url)`, `cleanSelector(value)`, `normalizeUuid(value)`.

- [ ] **Step 1: Create `src/params.js`** — move verbatim, prepending `export`: `UUID_PATTERN` (line 1), `GENERIC_UUID_PATTERN` (2), `ITEM_TAG_PATTERN` (3), `requireContainerId` (1354–1361), `readIntegerParameter` (1362–1372), `readTextParameter` (1373–1378), `requireEnumParameter` (1379–1386), `readOptionalBooleanParameter` (1387–1394), `readDetailParameter` (1395–1400), `requireItemTag` (1401–1408), `requireUuid` (1423–1430), `cleanSelector` (2845–2851), `normalizeUuid` (2852–2855). Add at top:

```js
import { ClientError } from "./http.js";
```

If `node --check` or tests show a validator does not reference `ClientError`, keep the import anyway only if at least one mover does; otherwise drop it.

- [ ] **Step 2: Wire `src/worker.js`** — add:

```js
import {
  cleanSelector,
  GENERIC_UUID_PATTERN,
  ITEM_TAG_PATTERN,
  normalizeUuid,
  readDetailParameter,
  readIntegerParameter,
  readOptionalBooleanParameter,
  readTextParameter,
  requireContainerId,
  requireEnumParameter,
  requireItemTag,
  requireUuid,
  UUID_PATTERN,
} from "./params.js";
```

Drop any name from this import that no remaining `src/worker.js` code references (Node tolerates unused imports, but do not keep dead ones).

- [ ] **Step 3: Verify** — Run: `node --check src/params.js && npm test && npm run deploy:dry`. Expected: exit 0; the suite's validation-error assertions (bad UUID, bad enum) exercise these paths.

- [ ] **Step 4: Commit**

```bash
git add src/params.js src/worker.js
git commit -m "refactor(worker): extract params module" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Extract `src/hypixel.js`

**Files:**
- Create: `src/hypixel.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: `UpstreamError` (and `ClientError` if referenced) from `./http.js`.
- Produces: `export async function fetchProfiles(uuid, env)`, `fetchHypixelJson(path, env, parameters = {}, options = {})`, `fetchSkyBlockItemNameMap(env)`, `fetchCollectionResource(env)`, `fetchSkillResource(env)`. Internal (unexported): `UPSTREAM_USER_AGENT` (line 7), `fetchJsonUpstream`, `getMemoryCache`, `setMemoryCache`, and the cache store they use.

- [ ] **Step 1: Create `src/hypixel.js`** — move verbatim: `UPSTREAM_USER_AGENT` (7), `fetchProfiles` (1431–1439), `fetchHypixelJson` (1440–1455), `fetchJsonUpstream` (1456–1509), `getMemoryCache` (1510–1520), `setMemoryCache` (1521–1529), `fetchSkyBlockItemNameMap` (1530–1537), `fetchCollectionResource` (1538–1553), `fetchSkillResource` (1554–1574). Also move any module-level cache map these functions reference (search `src/worker.js` for the identifier used inside `getMemoryCache`). Prepend `export` per the Produces list. Add imports actually referenced, starting from:

```js
import { UpstreamError } from "./http.js";
```

- [ ] **Step 2: Wire `src/worker.js`** — add:

```js
import {
  fetchCollectionResource,
  fetchHypixelJson,
  fetchProfiles,
  fetchSkillResource,
  fetchSkyBlockItemNameMap,
} from "./hypixel.js";
```

- [ ] **Step 3: Verify** — Run: `node --check src/hypixel.js && npm test && npm run deploy:dry`. Expected: exit 0; the suite stubs `globalThis.fetch`, so upstream paths and the memory cache are exercised.

- [ ] **Step 4: Commit**

```bash
git add src/hypixel.js src/worker.js
git commit -m "refactor(worker): extract hypixel upstream module" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Extract `src/items.js`

**Files:**
- Create: `src/items.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: `decodeBase64`, `decompressGzip`, `NbtReader` from `./nbt.js`; helpers from `./util.js` as referenced (at minimum `optionalNumber`/`stringOrNull`-class helpers — add exactly what the moved code names).
- Produces: `export async function decodeInventoryBlob(blob)` returning `{ present, items, records, error }`, `export async function compactAccessories(member)`, `export async function compactGear(member)`, `export function findNbtContainers(member)`, `findSacksCounts(member)`, `isNbtBlob(value)`, `containerMetadata(container)`, `inventoryContainerKind(path)`, `inventoryContainerLabel(path)`, `compactNbtItem(item, fallbackSlot)`, `expandNbtItem(record)`, `cleanItemName(value)`, `formatItemId(value)`. Internal unless referenced elsewhere: `inferArmorSlot`, `inferEquipmentCategory`, `flattenTextComponent`.

- [ ] **Step 1: Create `src/items.js`** — move verbatim: `decodeInventoryBlob` (2509–2532, per the spec's Task 3 amendment it moves here, not to `nbt.js`), `compactAccessories` (2308–2348), `findNbtContainers` (2349–2388), `findSacksCounts` (2389–2401), `isNbtBlob` (2402–2408), `containerMetadata` (2409–2418), `inventoryContainerKind` (2419–2437), `inventoryContainerLabel` (2438–2460), `compactGear` (2461–2508), `compactNbtItem` (2556–2590), `expandNbtItem` (2591–2613), `inferArmorSlot` (2614–2623), `inferEquipmentCategory` (2624–2633), `cleanItemName` (2634–2649), `flattenTextComponent` (2650–2656), `formatItemId` (2657–2666). Start imports from:

```js
import { decodeBase64, decompressGzip, NbtReader } from "./nbt.js";
```

and add the exact `./util.js` names the moved bodies reference.

- [ ] **Step 2: Wire `src/worker.js`** — add an import for every moved name still referenced by remaining `src/worker.js` code (handlers, sections, market compactors are all still in the file at this point), e.g.:

```js
import {
  cleanItemName,
  compactAccessories,
  compactGear,
  compactNbtItem,
  containerMetadata,
  decodeInventoryBlob,
  expandNbtItem,
  findNbtContainers,
  findSacksCounts,
  formatItemId,
  inventoryContainerKind,
  inventoryContainerLabel,
  isNbtBlob,
} from "./items.js";
```

Trim names with no remaining reference. Also delete the `import { decodeBase64, decompressGzip, NbtReader } from "./nbt.js";` line from `src/worker.js` — its only consumer (`decodeInventoryBlob`) just moved to `src/items.js`.

- [ ] **Step 3: Verify** — Run: `node --check src/items.js && npm test && npm run deploy:dry`. Expected: exit 0; accessory/inventory fixtures cover these moves.

- [ ] **Step 4: Commit**

```bash
git add src/items.js src/worker.js
git commit -m "refactor(worker): extract items module" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Extract `src/sections.js`

**Files:**
- Create: `src/sections.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: `compactGear`, `compactAccessories` (only if `buildSection` dispatches to them — check the moved body) from `./items.js`; `./util.js` helpers as referenced.
- Produces: `export const PROFILE_SECTIONS`; `export async function buildSection(section, profile, member, skillResource = null)`; `export function compactSkills(member, skillResource = null)`; `export function compactGarden(garden)`, `compactMuseum(profileData, query, page, limit)`, `flattenCollections(collections)`, `compactPlayerCollections(member, resource, query, page, limit, includeUnlocks = false)`, `compactCollectionItem(item)`. All other movers stay internal.

- [ ] **Step 1: Create `src/sections.js`** — move verbatim: `PROFILE_SECTIONS` (9–24), `compactGarden` (966–985), `compactMuseum` (986–1038), `flattenCollections` (1039–1059), `compactCollectionItem` (1066–1071), `compactPlayerCollections` (1072–1149), `compactCollectionTier` (1150–1163), `collectionUnlockText` (1164–1173), `buildSection` (1670–1704), `compactSkills` (1705–1751), `collectSkillExperience` (1752–1773), `normalizeSkillName` (1774–1780), `calculateSkillProgress` (1781–1843), `emptySkillProgress` (1844–1854), `compactMining` (1855–1911), `compactForge` (1912–1976), `isForgeProcess` (1977–1983), `compactForgeProcess` (1984–2037), `compactForaging` (2054–2118), `compactTreePerks` (2119–2138), `formatTreePerkName` (2139–2167), `compactPowder` (2168–2178), `compactStats` (2179–2215), `filterNumericStats` (2216–2226), `readTreeScopedValue` (2231–2236), `compactSlayers` (2250–2259), `compactDungeons` (2260–2289), `compactPets` (2290–2307). Add imports the bodies reference, from `./items.js` and `./util.js` only.

- [ ] **Step 2: Wire `src/worker.js`** — add:

```js
import {
  buildSection,
  compactGarden,
  compactMuseum,
  compactPlayerCollections,
  compactSkills,
  flattenCollections,
  PROFILE_SECTIONS,
} from "./sections.js";
```

Add/trim names to match what remaining handlers actually call. Also trim the Task 6 `./items.js` import in `src/worker.js` — names now consumed only by `src/sections.js` (e.g. `compactGear`) leave the worker import list.

- [ ] **Step 3: Verify** — Run: `node --check src/sections.js && npm test && npm run deploy:dry`. Expected: exit 0; forge/collections/skills fixtures cover this move.

- [ ] **Step 4: Commit**

```bash
git add src/sections.js src/worker.js
git commit -m "refactor(worker): extract sections module" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Extract `src/market.js`

**Files:**
- Create: `src/market.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: `decodeInventoryBlob`, `expandNbtItem`, `cleanItemName` from `./items.js` (per the spec's Task 3 amendment, `decodeInventoryBlob` lives in `items.js`); `sanitize`, `optionalNumber` (plus any other referenced helpers) from `./util.js`.
- Produces: `export function compactBazaarProduct(product, itemNames)`, `compareBazaarProducts(left, right, sort, order)`, `export async function compactAuction(auction, full = false)`, `compactEndedAuction(auction, full = false)`, `export function resolveSkyBlockItem(itemNames, requested)`, `normalizeItemSearchText(value)`, `skyBlockItemIdsMatch(left, right)`, `auctionPrice(auction)`, `binPrice(auction)`.

- [ ] **Step 1: Create `src/market.js`** — move verbatim: `compactBazaarProduct` (1181–1205), `compareBazaarProducts` (1206–1225), `compactAuction` (1238–1275), `resolveSkyBlockItem` (1276–1291), `normalizeItemSearchText` (1292–1299), `skyBlockItemIdsMatch` (1300–1304), `compactEndedAuction` (1305–1325), `auctionPrice` (1326–1331), `binPrice` (1332–1335). Start imports from:

```js
import { cleanItemName, decodeInventoryBlob, expandNbtItem } from "./items.js";
import { optionalNumber, sanitize } from "./util.js";
```

- [ ] **Step 2: Wire `src/worker.js`** — add:

```js
import {
  auctionPrice,
  binPrice,
  compactAuction,
  compactBazaarProduct,
  compactEndedAuction,
  compareBazaarProducts,
  normalizeItemSearchText,
  resolveSkyBlockItem,
  skyBlockItemIdsMatch,
} from "./market.js";
```

Trim unreferenced names; trim the worker's `./items.js` import if this move removed any name's last worker-side usage (no `./nbt.js` import exists in `src/worker.js` by this point).

- [ ] **Step 3: Verify** — Run: `node --check src/market.js && npm test && npm run deploy:dry`. Expected: exit 0; bazaar/lowest-BIN fixtures cover this move.

- [ ] **Step 4: Commit**

```bash
git add src/market.js src/worker.js
git commit -m "refactor(worker): extract market module" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Extract `src/profiles.js`

**Files:**
- Create: `src/profiles.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: `fetchProfiles` from `./hypixel.js`; `requireUuid`, `cleanSelector`, `readTextParameter` (as referenced by `loadSelectedMember`) from `./params.js`; `./util.js` helpers as referenced. (`buildOverview` is NOT here — the Task 7 amendment moved it into `src/sections.js` because `buildSection`'s `"overview"` case calls it.)
- Produces: `export async function loadSelectedMember(url, env)`, `export function selectProfile(profiles, uuid, selector)`, `compactProfile(profile, uuid)`, `getMember(profile, uuid)`, `isDeleted(member)`.

- [ ] **Step 1: Create `src/profiles.js`** — move verbatim: `loadSelectedMember` (1344–1353), `selectProfile` (1575–1600), `compactProfile` (1601–1617), `getMember` (2830–2840), `isDeleted` (2841–2844). (`buildOverview` already lives in `src/sections.js` — do not touch it.) Add exactly the imports the bodies reference, starting from:

```js
import { fetchProfiles } from "./hypixel.js";
```

- [ ] **Step 2: Wire `src/worker.js`** — add:

```js
import {
  compactProfile,
  getMember,
  loadSelectedMember,
  selectProfile,
} from "./profiles.js";
```

(`buildOverview` stays imported from `./sections.js` where Task 7 wired it.)

Trim unreferenced names and any now-dead worker imports (e.g. `fetchProfiles`, `cleanSelector` if handlers no longer call them directly).

- [ ] **Step 3: Verify** — Run: `node --check src/profiles.js && npm test && npm run deploy:dry`. Expected: exit 0; profile-selection fixtures cover this move.

- [ ] **Step 4: Commit**

```bash
git add src/profiles.js src/worker.js
git commit -m "refactor(worker): extract profiles module" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Extract `src/routes/player.js` and `src/routes/inventory.js`

**Files:**
- Create: `src/routes/player.js`, `src/routes/inventory.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: everything the handler bodies reference, imported with `../` prefixes (`../params.js`, `../profiles.js`, `../sections.js`, `../items.js`, `../hypixel.js`, `../http.js`, `../util.js`).
- Produces (all `export async function name(url, env)`):
  - `routes/player.js`: `handleProfiles`, `handleSummary`, `handleSection`, `handlePlayerCollections`, `handlePlayerAccessories`, `handleSacks`, `handlePlayerExtra`. Internal: `EXTRA_KINDS` (line 6), `compareSackItems` (1226–1237).
  - `routes/inventory.js`: `handleInventoryIndex`, `handleInventoryContainer`, `handleInventoryItem`.

- [ ] **Step 1: Create `src/routes/player.js`** — move verbatim: `EXTRA_KINDS` (6), `handleProfiles` (149–159), `handleSummary` (160–181), `handleSection` (182–216), `handlePlayerCollections` (217–238), `handlePlayerAccessories` (239–304), `handleSacks` (412–486), `handlePlayerExtra` (487–546), `compareSackItems` (1226–1237). Prepend `export` to the seven handlers only. Add imports for every referenced identifier from the modules listed in Consumes.

- [ ] **Step 2: Create `src/routes/inventory.js`** — move verbatim: `handleInventoryIndex` (305–336), `handleInventoryContainer` (337–380), `handleInventoryItem` (381–411). Prepend `export` to all three. Add imports as in Step 1.

- [ ] **Step 3: Wire `src/worker.js`** — add:

```js
import {
  handlePlayerAccessories,
  handlePlayerCollections,
  handlePlayerExtra,
  handleProfiles,
  handleSacks,
  handleSection,
  handleSummary,
} from "./routes/player.js";
import {
  handleInventoryContainer,
  handleInventoryIndex,
  handleInventoryItem,
} from "./routes/inventory.js";
```

Trim worker imports whose last user just moved out (most domain-module names leave `src/worker.js` here).

- [ ] **Step 4: Verify** — Run: `node --check src/routes/player.js && node --check src/routes/inventory.js && npm test && npm run deploy:dry`. Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/routes/player.js src/routes/inventory.js src/worker.js
git commit -m "refactor(worker): extract player and inventory routes" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Extract `src/routes/market.js` and `src/routes/misc.js`

**Files:**
- Create: `src/routes/market.js`, `src/routes/misc.js`
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: `../market.js`, `../hypixel.js`, `../params.js`, `../http.js`, `../util.js`, `../items.js` as referenced by the handler bodies.
- Produces (all `export async function name(url, env)`):
  - `routes/market.js`: `handleBazaarProducts`, `handleBazaarProduct`, `handleAuctionPage`, `handleLowestBin`, `handleAuctionLookup`, `handleEndedAuctions`.
  - `routes/misc.js`: `handleResources`, `handleFeed`. Internal: `RESOURCE_KINDS` (4), `FEED_KINDS` (5), `compactResourceItem` (1060–1065), `resourceRecordMatches` (1174–1180).

- [ ] **Step 1: Create `src/routes/market.js`** — move verbatim: `handleBazaarProducts` (617–654), `handleBazaarProduct` (655–692), `handleAuctionPage` (693–757), `handleLowestBin` (758–900), `handleAuctionLookup` (901–937), `handleEndedAuctions` (938–965). Prepend `export` to all six; add referenced imports.

- [ ] **Step 2: Create `src/routes/misc.js`** — move verbatim: `RESOURCE_KINDS` (4), `FEED_KINDS` (5), `handleResources` (547–599), `handleFeed` (600–616), `compactResourceItem` (1060–1065), `resourceRecordMatches` (1174–1180). Prepend `export` to the two handlers; add referenced imports.

- [ ] **Step 3: Wire `src/worker.js`** — add:

```js
import {
  handleAuctionLookup,
  handleAuctionPage,
  handleBazaarProduct,
  handleBazaarProducts,
  handleEndedAuctions,
  handleLowestBin,
} from "./routes/market.js";
import { handleFeed, handleResources } from "./routes/misc.js";
```

After this task the only imports left in `src/worker.js` should be the four `routes/*` blocks plus `json`/`privacyPolicy` (and error classes) from `./http.js`. Delete every other import line — if `npm test` still passes, nothing else was needed.

- [ ] **Step 4: Verify** — Run: `node --check src/routes/market.js && node --check src/routes/misc.js && npm test && npm run deploy:dry`. Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/routes/market.js src/routes/misc.js src/worker.js
git commit -m "refactor(worker): extract market and misc routes" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Slim `src/worker.js` to a route table

**Files:**
- Modify: `src/worker.js`

**Interfaces:**
- Consumes: all 18 handlers from `./routes/*.js`; `json`, `privacyPolicy`, `ClientError`, `UpstreamError` from `./http.js`.
- Produces: `export default { fetch }` — unchanged external contract. `secretsMatch` (2893–2906) stays in this file, byte-identical.

- [ ] **Step 1: Replace the if-chain** — inside the existing `try` block, delete the 18 `if (url.pathname === ...)` branches and the trailing 404 return, and add a module-level table above `export default`:

```js
const ROUTES = new Map([
  ["/v1/player/profiles", handleProfiles],
  ["/v1/player/summary", handleSummary],
  ["/v1/player/section", handleSection],
  ["/v1/player/collections", handlePlayerCollections],
  ["/v1/player/accessories", handlePlayerAccessories],
  ["/v1/player/inventories", handleInventoryIndex],
  ["/v1/player/inventory", handleInventoryContainer],
  ["/v1/player/item", handleInventoryItem],
  ["/v1/player/sacks", handleSacks],
  ["/v1/player/extra", handlePlayerExtra],
  ["/v1/resources", handleResources],
  ["/v1/feed", handleFeed],
  ["/v1/bazaar/products", handleBazaarProducts],
  ["/v1/bazaar/product", handleBazaarProduct],
  ["/v1/auctions/page", handleAuctionPage],
  ["/v1/auctions/lowest-bin", handleLowestBin],
  ["/v1/auctions/lookup", handleAuctionLookup],
  ["/v1/auctions/ended", handleEndedAuctions],
]);
```

The try block becomes:

```js
try {
  const handler = ROUTES.get(url.pathname);
  if (!handler) {
    return json({ success: false, error: "Route not found." }, 404);
  }
  return await handler(url, env);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unexpected proxy error.";
  const status = error instanceof ClientError || error instanceof UpstreamError ? error.status : 500;
  return json({ success: false, error: message }, status);
}
```

Everything before the `try` (OPTIONS/CORS block, method check, `/health` with version `2.5.0`, `/privacy`, secret-presence check, `secretsMatch` call) stays byte-identical, as does `secretsMatch` itself.

- [ ] **Step 2: Confirm nothing else remains** — `src/worker.js` should now contain only: imports, `ROUTES`, `export default { fetch }`, and `secretsMatch`. Run: `grep -c "^function\|^async function\|^class" src/worker.js` — Expected: `1` (only `secretsMatch`).

- [ ] **Step 3: Verify** — Run: `npm test && npm run deploy:dry`. Expected: exit 0; the suite's 404, 401, 405, `/health`, and `/privacy` assertions prove the lifecycle is intact.

- [ ] **Step 4: Commit**

```bash
git add src/worker.js
git commit -m "refactor(worker): replace route if-chain with map" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Update release and validate scripts for multi-file `src/`

**Files:**
- Modify: `scripts/package-release.mjs`
- Modify: `scripts/validate.mjs`

**Interfaces:**
- Consumes: the `src/` directory tree produced by Tasks 1–12.
- Produces: release ZIP containing `cloudflare-worker/` (full `src/` tree); validation that syntax-checks every `src/**/*.js`.

- [ ] **Step 1: Edit `scripts/package-release.mjs`** — replace the single-file entry:

```js
  ["src/worker.js", "cloudflare-worker.js"],
```

with:

```js
  ["src", "cloudflare-worker"],
```

and make the copy recursive by replacing:

```js
for (const [source, destination] of files) {
  cpSync(resolve(root, source), resolve(stage, destination));
}
```

with:

```js
for (const [source, destination] of files) {
  cpSync(resolve(root, source), resolve(stage, destination), { recursive: true });
}
```

- [ ] **Step 2: Edit `scripts/validate.mjs`** — change the imports line `import { readFileSync } from "node:fs";` to:

```js
import { readdirSync, readFileSync } from "node:fs";
```

and replace the single-file check:

```js
try {
  execFileSync(process.execPath, ["--check", resolve(root, "src/worker.js")], { stdio: "pipe" });
} catch (error) {
  errors.push(`src/worker.js: JavaScript syntax check failed\n${error.stderr?.toString() || error.message}`);
}
```

with:

```js
const workerSources = [];
const collectWorkerSources = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      collectWorkerSources(full);
    } else if (entry.name.endsWith(".js")) {
      workerSources.push(full);
    }
  }
};
collectWorkerSources(resolve(root, "src"));
for (const file of workerSources) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    errors.push(`${file}: JavaScript syntax check failed\n${error.stderr?.toString() || error.message}`);
  }
}
```

- [ ] **Step 3: Verify** — Run: `npm test && npm run release:zip && rm -rf dist`. Expected: validate output unchanged in shape; `release:zip` prints `{"success":true,...}` (requires `zip`; if the `zip` binary is missing locally, the script's own error message is acceptable — CI covers it) and `dist` is removed afterward.

- [ ] **Step 4: Commit**

```bash
git add scripts/package-release.mjs scripts/validate.mjs
git commit -m "build: handle multi-file worker in release and validate scripts" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Update docs for the module layout

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/CHANGE_PLAYBOOK.md`

**Interfaces:**
- Consumes: final module layout from Tasks 1–12.
- Produces: docs that name the real files.

- [ ] **Step 1: `README.md`** — in the repository-layout tree, replace:

```text
src/worker.js                         Cloudflare Worker
```

with:

```text
src/worker.js                         Cloudflare Worker entry (auth, route table)
src/*.js, src/routes/*.js             Worker domain and route modules
```

- [ ] **Step 2: `AGENTS.md`** — two edits. In the source-of-truth map, replace:

```markdown
- `src/worker.js`: deployed Cloudflare Worker and all compact Hypixel behavior.
```

with:

```markdown
- `src/worker.js`: deployed Cloudflare Worker entry point (auth, CORS, route table); domain and route modules live in `src/*.js` and `src/routes/*.js`.
```

In Implementation constraints, replace:

```markdown
- Keep `src/worker.js` dependency-free unless there is a strong reason to change the deployment model.
```

with:

```markdown
- Keep everything under `src/` dependency-free (local ES modules only) unless there is a strong reason to change the deployment model.
```

- [ ] **Step 3: `docs/CHANGE_PLAYBOOK.md`** — three edits. Replace:

```markdown
2. Fix `src/worker.js` while keeping route, parameter, operation ID, and response shape compatible.
```

with:

```markdown
2. Fix the relevant module under `src/` while keeping route, parameter, operation ID, and response shape compatible.
```

Replace:

```markdown
2. Add or update the route/handler in `src/worker.js`.
```

with:

```markdown
2. Add or update the handler in the matching `src/routes/*.js` file and register the path in the `ROUTES` map in `src/worker.js`.
```

Replace:

```markdown
1. Add the section name to `PROFILE_SECTIONS`.
2. Implement its compact builder under `buildSection`.
```

with:

```markdown
1. Add the section name to `PROFILE_SECTIONS` in `src/sections.js`.
2. Implement its compact builder under `buildSection` in `src/sections.js`.
```

- [ ] **Step 4: Verify** — Run: `npm test`. Expected: exit 0 (docs changes must not affect validation).

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md docs/CHANGE_PLAYBOOK.md
git commit -m "docs: update file references for worker modules" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Final verification sweep

**Files:**
- None modified (fix-forward only if a check fails).

**Interfaces:**
- Consumes: the completed branch.
- Produces: evidence for the handoff report.

- [ ] **Step 1: Full suite** — Run: `npm test && npm run deploy:dry`. Expected: exit 0.

- [ ] **Step 2: No stale code** — Run: `wc -l src/*.js src/routes/*.js` (every file well under 1,000 lines; `src/worker.js` roughly 100–170) and `grep -rn "TODO\|FIXME" src/` (Expected: no output).

- [ ] **Step 3: Contract spot-check** — Run: `grep -rn "2.5.0" src/` — Expected: exactly the two original version usages (`UPSTREAM_USER_AGENT` in `src/hypixel.js`, `/health` in `src/worker.js`). Run: `git diff main -- wrangler.jsonc scripts/test-worker.mjs actions gpt` — Expected: no output (untouched).

- [ ] **Step 4: Report** — hand off with: behavior unchanged; contract identical; merging to `main` auto-deploys the Worker (`src/**` trigger); no manual GPT Builder update needed (no `actions/` or `gpt/` changes); note any bugs observed-but-not-fixed during the move.
