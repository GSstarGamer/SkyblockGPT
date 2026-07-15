# Worker Correctness Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 11 confirmed Worker bugs and split the test harness so four agents can work concurrently without conflicting.

**Architecture:** Phase 0 runs solo and resolves the three cross-cutting concerns (test harness split, cache policy centralization, `sanitize` truncation contract). Phase 1 then fans out four agents that own disjoint files. No task in this plan touches `actions/` or `gpt/`, so nothing here requires a manual GPT Builder sync.

**Tech Stack:** Cloudflare Workers, JavaScript ES modules, Node.js 20+, `node:assert/strict`. No test framework, no dependencies under `src/`.

**Spec:** `docs/superpowers/specs/2026-07-15-worker-data-coverage-and-correctness-design.md`

## Global Constraints

- Everything under `src/` stays dependency-free — local ES modules only (`AGENTS.md`).
- Only `GET` and `OPTIONS` are supported.
- Never hard-code a player identity. `AdamWarlock447` and `Mango` are test fixtures, not defaults.
- Missing/disabled/undecodable API data is unavailable — never zero (`AGENTS.md` rule 5).
- Never call a partial auction scan a global lowest BIN (`AGENTS.md` rule 6).
- Preserve typed response conventions: `success`, `payload_kind`, pagination metadata, `data_present`, explicit completeness indicators (`AGENTS.md`).
- Player profiles are never cached or persisted (`AGENTS.md`, `/privacy`).
- Response bodies stay under 80,000 characters (`src/http.js:8`).
- Hypixel timestamps are Unix milliseconds.
- Every task ends with `npm test` passing. Phase-final tasks also run `npm run deploy:dry`.
- Do not rename existing routes, operation IDs, parameters, or response fields. Additive response fields only.

## Prerequisite (human, before any task)

The working tree is dirty: `AGENTS.md`, `docs/CHANGE_PLAYBOOK.md`, `gpt/config.md`, `gpt/instructions.md`, `scripts/validate.mjs` modified; `gpt/knowledge/` untracked. That work is one coherent unit (knowledge files plus the validator enforcing their pointers). Commit it before starting. No task below touches those files, but Phase 2 will.

---

## Phase 0 — prep (solo, blocking)

Phase 1 MUST NOT start until every Phase 0 task is committed.

### Task 1: Split the test harness

`scripts/test-worker.mjs` is a 202-line linear script. Every Phase 1 lane needs to add tests, and appending to one shared file guarantees merge conflicts. Split it into a shared fixture module, one file per area, and a runner that pre-registers every file — including empty stubs the lanes fill in, so no lane ever edits the runner.

**Files:**
- Create: `scripts/tests/_fixtures.mjs`
- Create: `scripts/tests/health.test.mjs`
- Create: `scripts/tests/player.test.mjs`
- Create: `scripts/tests/market.test.mjs`
- Create: `scripts/tests/cache.test.mjs` (stub, filled by Task 2)
- Create: `scripts/tests/sections.test.mjs` (stub, filled by Lane D)
- Create: `scripts/tests/util.test.mjs` (stub, filled by Task 3)
- Create: `scripts/tests/items.test.mjs` (stub, filled by Lane C)
- Create: `scripts/tests/levels.test.mjs` (stub, filled by Lane E)
- Modify: `scripts/test-worker.mjs` (becomes the runner)

**Interfaces:**
- Consumes: nothing.
- Produces: `installMockFetch(overrides?)`, `call(path, authenticated?)`, `playerUuid`, `itemNbt`, `auction(uuid, price, bin?)`, `env`, `defaultHandlers()` from `scripts/tests/_fixtures.mjs`. Every test file exports `async function run()`.

- [ ] **Step 1: Create the shared fixture module**

Each test file installs its own mock at the top of `run()`, so per-file overrides never leak. Handlers are keyed by pathname and receive the parsed `URL`.

Create `scripts/tests/_fixtures.mjs`:

```js
import worker from "../../src/worker.js";

export const playerUuid = "0123456789abcdef0123456789abcdef";
export const profileId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const itemNbt = "H4sIAAAAAAAAAB2NQQqCQBhGv1ErHaKu0KoLtGtnarRIhTpA/OGfDIwZ4wxUF/IeHiyyto/3eBKIIJQEIDx4qsJaYJK07m6FhG+p9hEdVMV7TXU3Wh+JWaW6h6ZXhODYGg5/LeZDfxt6nZR5XhYhgoIaxmKE8dsZXu20YwuJZfa0hmJrjbo6y134f8pTll5O5TnbbgAP05Qaqhk+8AVIrd2eoAAAAA==";

export const env = { HYPIXEL_API_KEY: "hypixel-test", GPT_SHARED_SECRET: "shared-test" };

export const auction = (uuid, price, bin = true) => ({
  uuid,
  auctioneer: playerUuid,
  profile_id: profileId,
  start: 1,
  end: 9_999_999_999_999,
  item_name: "Azure Bluet",
  extra: "Azure Bluet Red Rose",
  category: "blocks",
  tier: "COMMON",
  starting_bid: price,
  highest_bid_amount: bin ? price : 0,
  bin,
  bids: [],
  item_bytes: { type: 0, data: itemNbt },
});

export const member = () => ({
  last_save: 100,
  collection: { COBBLESTONE: 750, DIAMOND: 25 },
  accessory_bag_storage: { selected_power: "fortuitous", highest_magical_power: 465 },
  forge: {
    forge_processes: {
      forge_1: {
        0: { id: "REFINED_MITHRIL", type: "REFINING", startTime: 1_700_000_000_000, duration_ms: 21_600_000 },
        1: { id: "REFINED_TITANIUM", type: "REFINING", startTime: 1_700_000_000_000 },
        2: { id: "PET", type: "CASTING", startTime: 1_700_000_000_000, endTime: 1_700_000_001_000 },
      },
    },
  },
  inventory: {
    talisman_bag: { type: 0, data: itemNbt },
    sacks_counts: { ENCHANTED_TITANIUM: 16, AZURE_BLUET: 0 },
  },
});

export function defaultHandlers() {
  return {
    "/v2/skyblock/profiles": () => Response.json({
      success: true,
      profiles: [{
        profile_id: profileId,
        cute_name: "Mango",
        selected: true,
        members: { [playerUuid]: member() },
      }],
    }),

    "/v2/resources/skyblock/collections": () => Response.json({
      success: true,
      lastUpdated: 123,
      version: "test",
      collections: {
        MINING: {
          name: "Mining",
          items: {
            COBBLESTONE: {
              name: "Cobblestone",
              maxTiers: 3,
              tiers: [
                { tier: 1, amountRequired: 50, unlocks: ["Cobblestone Minion Recipe"] },
                { tier: 2, amountRequired: 100, unlocks: ["Compactor Recipe"] },
                { tier: 3, amountRequired: 1000, unlocks: ["Haste Ring Recipe"] },
              ],
            },
          },
        },
      },
    }),

    "/v2/resources/skyblock/items": () => Response.json({
      success: true,
      lastUpdated: 123,
      items: [
        { id: "RED_ROSE:3", name: "Azure Bluet" },
        { id: "ENCHANTED_TITANIUM", name: "Enchanted Titanium" },
        { id: "BOOSTER_COOKIE", name: "Booster Cookie" },
      ],
    }),

    "/v2/resources/skyblock/skills": () => Response.json({
      success: true,
      lastUpdated: 123,
      version: "test",
      skills: {
        MINING: {
          name: "Mining",
          maxLevel: 3,
          levels: [
            { level: 1, totalExpRequired: 50 },
            { level: 2, totalExpRequired: 175 },
            { level: 3, totalExpRequired: 375 },
          ],
        },
      },
    }),

    "/v2/resources/skyblock/election": () => Response.json({
      success: true, lastUpdated: 123, mayor: { key: "test", name: "Test Mayor" },
    }),

    "/v2/resources/skyblock/bingo": () => Response.json({
      success: true, lastUpdated: 123, id: 1, goals: [{ id: "goal", name: "Goal" }],
    }),

    "/v2/skyblock/bazaar": () => Response.json({
      success: true,
      lastUpdated: 456,
      products: {
        BOOSTER_COOKIE: {
          product_id: "BOOSTER_COOKIE",
          sell_summary: [{ amount: 4, pricePerUnit: 100, orders: 1 }],
          buy_summary: [{ amount: 5, pricePerUnit: 90, orders: 2 }],
          quick_status: {
            productId: "BOOSTER_COOKIE",
            sellPrice: 100, sellVolume: 10, sellMovingWeek: 70, sellOrders: 3,
            buyPrice: 90, buyVolume: 20, buyMovingWeek: 140, buyOrders: 4,
          },
        },
      },
    }),

    "/v2/skyblock/auctions": (url) => {
      const page = Number(url.searchParams.get("page") || 0);
      return Response.json({
        success: true,
        page,
        totalPages: 2,
        totalAuctions: 4,
        lastUpdated: 456,
        auctions: page === 0
          ? [auction("a", 100), auction("b", 75), auction("c", 1, false)]
          : [auction("d", 50)],
      });
    },

    "/v2/skyblock/auctions_ended": () => Response.json({
      success: true,
      lastUpdated: 456,
      auctions: [{
        auction_id: "ended-1",
        seller: playerUuid,
        seller_profile: profileId,
        buyer: "ffffffffffffffffffffffffffffffff",
        timestamp: 1_700_000_000_000,
        price: 4200,
        bin: true,
        item_bytes: itemNbt,
      }],
    }),

    "/v2/skyblock/auction": () => Response.json({
      success: true,
      auctions: [auction("lookup-1", 999)],
    }),

    "/v2/skyblock/museum": () => Response.json({
      success: true,
      profile: {
        [playerUuid]: {
          value: 1234,
          appraisal: false,
          items: { ZOMBIE_SWORD: { donated_time: 1_700_000_000_000, items: { type: 0, data: itemNbt } } },
          special: [{ donated_time: 1_700_000_000_001, items: { type: 0, data: itemNbt } }],
        },
      },
    }),

    "/v2/skyblock/garden": () => Response.json({
      success: true,
      garden: { uuid: profileId, garden_experience: 5000, unlocked_plots_ids: ["beginner_1"] },
    }),

    "/v2/skyblock/bingo": () => Response.json({
      success: true,
      events: [{ key: 1, points: 40, completed_goals: ["goal"] }],
    }),

    "/v2/skyblock/news": () => Response.json({
      success: true,
      items: [{ title: "Update", link: "https://hypixel.net/x", text: "notes" }],
    }),

    "/v2/skyblock/firesales": () => Response.json({
      success: true,
      sales: [{ item_id: "DYE", start: 1, end: 2, amount: 3, price: 4 }],
    }),
  };
}

export let fetchLog = [];

export function installMockFetch(overrides = {}) {
  const handlers = { ...defaultHandlers(), ...overrides };
  fetchLog = [];
  globalThis.fetch = async (input) => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === "string" ? input : input.url);
    fetchLog.push(url.pathname);
    const handler = handlers[url.pathname];
    if (!handler) throw new Error(`Unexpected upstream URL: ${url}`);
    return handler(url);
  };
}

export function countFetches(pathname) {
  return fetchLog.filter((entry) => entry === pathname).length;
}

export const call = async (path, authenticated = true) => worker.fetch(
  new Request(`https://worker.test${path}`, {
    headers: authenticated ? { "X-GPT-Key": "shared-test" } : {},
  }),
  env,
);
```

- [ ] **Step 2: Create health/auth tests**

Create `scripts/tests/health.test.mjs`:

```js
import assert from "node:assert/strict";
import { call, installMockFetch, playerUuid } from "./_fixtures.mjs";

export async function run() {
  installMockFetch();

  const health = await (await call("/health", false)).json();
  assert.equal(health.success, true);
  assert.equal(health.version, "2.5.1");

  const unauthorized = await call(`/v1/player/profiles?uuid=${playerUuid}`, false);
  assert.equal(unauthorized.status, 401);
}
```

- [ ] **Step 3: Create player tests**

Port the existing collections/accessories/forge/sacks assertions verbatim. Create `scripts/tests/player.test.mjs`:

```js
import assert from "node:assert/strict";
import { call, installMockFetch, playerUuid } from "./_fixtures.mjs";

export async function run() {
  installMockFetch();

  const collectionsResponse = await call(`/v1/player/collections?uuid=${playerUuid}&query=cobble&include_unlocks=true`);
  const collections = await collectionsResponse.json();
  assert.equal(collectionsResponse.status, 200, JSON.stringify(collections));
  assert.equal(collections.payload_kind, "player_collections");
  assert.equal(collections.data.collections[0].achieved_tier, 2);
  assert.equal(collections.data.collections[0].next_tier, 3);
  assert.deepEqual(collections.data.collections[0].unlocked_rewards, ["Cobblestone Minion Recipe", "Compactor Recipe"]);

  const accessoriesResponse = await call(`/v1/player/accessories?uuid=${playerUuid}`);
  const accessories = await accessoriesResponse.json();
  assert.equal(accessoriesResponse.status, 200, JSON.stringify(accessories));
  assert.equal(accessories.payload_kind, "player_accessories");
  assert.equal(accessories.data.total_accessories, 1);
  assert.equal(accessories.data.selected_power, "fortuitous");
  assert.equal(accessories.data.highest_magical_power, 465);

  const forgeResponse = await call(`/v1/player/section?uuid=${playerUuid}&section=forge`);
  const forge = await forgeResponse.json();
  assert.equal(forgeResponse.status, 200, JSON.stringify(forge));
  assert.equal(forge.payload_kind, "profile_section_forge");
  assert.equal(forge.data.processes.length, 3);
  assert.equal(forge.data.processes.some((process) => process.needs_wiki_duration), true);

  const sacksResponse = await call(`/v1/player/sacks?uuid=${playerUuid}&query=titanium`);
  const sacks = await sacksResponse.json();
  assert.equal(sacksResponse.status, 200, JSON.stringify(sacks));
  assert.equal(sacks.data.items[0].item_id, "ENCHANTED_TITANIUM");
  assert.equal(sacks.data.items[0].quantity, 16);
}
```

- [ ] **Step 4: Create market tests**

Port existing bazaar/auction assertions. The `totalPages: 2` fixture stays — it proves completeness works when genuinely reachable. Lane B adds the realistic large-AH case.

Create `scripts/tests/market.test.mjs`:

```js
import assert from "node:assert/strict";
import { call, installMockFetch } from "./_fixtures.mjs";

export async function run() {
  installMockFetch();

  const bazaarSearch = await (await call("/v1/bazaar/products?query=booster")).json();
  assert.equal(bazaarSearch.payload_kind, "bazaar_product_index");
  assert.equal(bazaarSearch.data.items[0].product_id, "BOOSTER_COOKIE");

  const bazaarProduct = await (await call("/v1/bazaar/product?product=BOOSTER_COOKIE")).json();
  assert.equal(bazaarProduct.payload_kind, "bazaar_product");
  assert.equal(bazaarProduct.data.sell_summary[0].pricePerUnit, 100);

  const lowest = await (await call("/v1/auctions/lowest-bin?item=RED_ROSE%3A3")).json();
  assert.equal(lowest.data.scan.complete, true);
  assert.equal(lowest.data.authoritative_lowest_bin.bin_price, 50);
  assert.deepEqual(lowest.data.auctions.map((entry) => entry.bin_price), [50, 75, 100]);

  const page = await (await call("/v1/auctions/page?upstream_page=0&bin=true&sort=price_desc")).json();
  assert.deepEqual(page.data.items.map((entry) => entry.current_price), [100, 75]);
}
```

- [ ] **Step 5: Create the five stub test files**

Lanes fill these in. Pre-registering them in the runner now is what keeps lanes from ever editing the runner.

Create each of `scripts/tests/cache.test.mjs`, `scripts/tests/sections.test.mjs`, `scripts/tests/util.test.mjs`, `scripts/tests/items.test.mjs`, `scripts/tests/levels.test.mjs` with exactly:

```js
export async function run() {
  // Filled in by a later task. See docs/superpowers/plans/2026-07-15-worker-correctness-pass.md
}
```

- [ ] **Step 6: Replace the runner**

Replace the entire contents of `scripts/test-worker.mjs`:

```js
import { run as runHealth } from "./tests/health.test.mjs";
import { run as runPlayer } from "./tests/player.test.mjs";
import { run as runMarket } from "./tests/market.test.mjs";
import { run as runCache } from "./tests/cache.test.mjs";
import { run as runSections } from "./tests/sections.test.mjs";
import { run as runUtil } from "./tests/util.test.mjs";
import { run as runItems } from "./tests/items.test.mjs";
import { run as runLevels } from "./tests/levels.test.mjs";

const suites = [
  ["health", runHealth],
  ["player", runPlayer],
  ["market", runMarket],
  ["cache", runCache],
  ["sections", runSections],
  ["util", runUtil],
  ["items", runItems],
  ["levels", runLevels],
];

let failed = 0;
for (const [name, run] of suites) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failed) {
  console.error(`\n${failed} suite(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${suites.length} suites passed.`);
```

- [ ] **Step 7: Run the suite**

Run: `npm test`
Expected: PASS. Prints `ok - health` through `ok - levels`, then `All 8 suites passed.` The five stubs pass trivially.

- [ ] **Step 8: Commit**

```bash
git add scripts/test-worker.mjs scripts/tests/
git commit -m "test(worker): split harness into per-area suites

Single 202-line script forced every concurrent lane to append to the
same file. Split into shared fixtures, one suite per area, and a runner
that pre-registers stub suites so lanes never edit the runner.

Adds mocks the old harness lacked: museum, garden, bingo, ended,
lookup, skills resource, news, firesales, election. Those routes were
previously untested because the mock threw on any unknown URL.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Centralize cache policy and delete the persistent-cache branch

TTLs live scattered across four route files as `cacheSeconds` arguments — which is exactly why player museum/garden/bingo drifted to 60s against `AGENTS.md`. Move them to one map keyed by upstream path, defaulting to 0 so caching is opt-in.

The `persistentCache` branch is unreachable (`fetchHypixelJson` never passes it) and would write player profiles to Cloudflare's edge cache if wired — forbidden by `AGENTS.md` and `/privacy`. No Cloudflare cache is configured. Delete it.

**Files:**
- Modify: `src/hypixel.js`
- Modify: `src/routes/player.js:287-289`, `:311-313`, `:324-326` (drop `cacheSeconds` args)
- Modify: `src/routes/market.js:42`, `:74`, `:125-128`, `:188-191`, `:234-237`, `:334-337`, `:360-363` (drop `cacheSeconds` args)
- Modify: `src/routes/misc.js:28-32`, `:77-80` (drop `cacheSeconds` args and the computed `cacheSeconds` local)
- Test: `scripts/tests/cache.test.mjs`

**Interfaces:**
- Consumes: `installMockFetch`, `call`, `countFetches` from Task 1.
- Produces: `resetCaches()` exported from `src/hypixel.js`. `fetchHypixelJson(path, env, parameters, options)` keeps its signature but ignores `options.cacheSeconds`; TTL comes from `CACHE_POLICY`.

- [ ] **Step 1: Write the failing test**

Replace `scripts/tests/cache.test.mjs`:

```js
import assert from "node:assert/strict";
import { call, countFetches, installMockFetch, playerUuid } from "./_fixtures.mjs";
import { resetCaches } from "../../src/hypixel.js";

export async function run() {
  // Market data is never cached: two calls must hit upstream twice.
  installMockFetch();
  resetCaches();
  await call("/v1/bazaar/products?query=booster");
  await call("/v1/bazaar/products?query=booster");
  assert.equal(countFetches("/v2/skyblock/bazaar"), 2, "bazaar must not be cached");

  // Player profiles are never cached (AGENTS.md, /privacy).
  installMockFetch();
  resetCaches();
  await call(`/v1/player/sacks?uuid=${playerUuid}`);
  await call(`/v1/player/sacks?uuid=${playerUuid}`);
  assert.equal(countFetches("/v2/skyblock/profiles"), 2, "profiles must not be cached");

  // Player museum is never cached. Was 60s, against AGENTS.md.
  installMockFetch();
  resetCaches();
  await call(`/v1/player/extra?uuid=${playerUuid}&kind=museum`);
  await call(`/v1/player/extra?uuid=${playerUuid}&kind=museum`);
  assert.equal(countFetches("/v2/skyblock/museum"), 2, "player museum must not be cached");

  // Static resource tables are cached: second call is served from memory.
  installMockFetch();
  resetCaches();
  await call("/v1/resources?kind=items&query=azure");
  await call("/v1/resources?kind=items&query=azure");
  assert.equal(countFetches("/v2/resources/skyblock/items"), 1, "static items resource must be cached");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `not ok - cache`, with `SyntaxError` or `does not provide an export named 'resetCaches'`.

- [ ] **Step 3: Rewrite the caching core**

In `src/hypixel.js`, replace everything from `const memoryCache = new Map();` through the end of `setMemoryCache` with:

```js
const memoryCache = new Map();

// Cache TTL in seconds, keyed by upstream path. Caching is opt-in: anything
// absent gets 0. Player data is never cached (AGENTS.md, /privacy) and market
// data changes too fast to be worth staleness.
const CACHE_POLICY = new Map([
  ["/v2/skyblock/profiles", 0],
  ["/v2/skyblock/museum", 0],
  ["/v2/skyblock/garden", 0],
  ["/v2/skyblock/bingo", 0],
  ["/v2/skyblock/bazaar", 0],
  ["/v2/skyblock/auctions", 0],
  ["/v2/skyblock/auction", 0],
  ["/v2/skyblock/auctions_ended", 0],
  ["/v2/skyblock/firesales", 60],
  ["/v2/resources/skyblock/election", 60],
  ["/v2/skyblock/news", 300],
  ["/v2/resources/skyblock/bingo", 300],
  ["/v2/resources/skyblock/items", 21_600],
  ["/v2/resources/skyblock/skills", 21_600],
  ["/v2/resources/skyblock/collections", 21_600],
]);

function cacheSecondsFor(path) {
  return CACHE_POLICY.get(path) ?? 0;
}

export function resetCaches() {
  memoryCache.clear();
  cachedSkillResource = null;
  cachedSkillResourceExpiresAt = 0;
}

export async function fetchHypixelJson(path, env, parameters = {}, options = {}) {
  const endpoint = new URL(path, "https://api.hypixel.net");
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== null && value !== undefined && value !== "") endpoint.searchParams.set(key, String(value));
  }
  const headers = { "User-Agent": UPSTREAM_USER_AGENT, Accept: "application/json" };
  if (options.authenticated) headers["API-Key"] = env.HYPIXEL_API_KEY;
  return fetchJsonUpstream(endpoint, {
    headers,
    cacheKey: `hypixel:${endpoint.toString()}`,
    cacheSeconds: cacheSecondsFor(path),
    timeoutMs: options.timeoutMs || 12_000,
    provider: "Hypixel",
  });
}

async function fetchJsonUpstream(endpoint, options) {
  const cached = getMemoryCache(options.cacheKey);
  if (cached !== null) return cached;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 12_000);
  let response;
  try {
    response = await fetch(endpoint, { headers: options.headers, signal: controller.signal });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new UpstreamError(`${options.provider} took too long to respond.`, 504);
    }
    throw new UpstreamError(`${options.provider} could not be reached.`, 502);
  } finally {
    clearTimeout(timeout);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new UpstreamError(`${options.provider} returned a non-JSON response (${response.status}).`, response.status);
  }
  if (!response.ok || payload?.success === false) {
    const cause = payload?.cause || payload?.error || payload?.message || `${options.provider} request failed (${response.status}).`;
    const suffix = response.status === 429 ? " Respect Retry-After and try again later." : "";
    throw new UpstreamError(`${cause}${suffix}`, response.status);
  }
  if (options.cacheSeconds > 0) {
    setMemoryCache(options.cacheKey, payload, options.cacheSeconds);
  }
  return payload;
}

function getMemoryCache(key) {
  if (!key) return null;
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function setMemoryCache(key, value, seconds) {
  if (!key || seconds <= 0) return;
  if (memoryCache.size >= 80) {
    const oldest = memoryCache.keys().next().value;
    if (oldest) memoryCache.delete(oldest);
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + seconds * 1_000 });
}
```

The `persistentCache` block, its `Request`, and both `caches.default` calls are gone.

- [ ] **Step 4: Move the skill-resource cache declarations above `resetCaches`**

`resetCaches` assigns `cachedSkillResource`, so the `let` declarations must precede it in module order. In `src/hypixel.js`, delete these two lines from their current position just above `fetchSkillResource`:

```js
let cachedSkillResource = null;
let cachedSkillResourceExpiresAt = 0;
```

and re-add them immediately below `const memoryCache = new Map();`.

- [ ] **Step 5: Drop `cacheSeconds` from every call site**

In `src/hypixel.js`, the four internal callers keep only their remaining options:

```js
// fetchProfiles
const payload = await fetchHypixelJson("/v2/skyblock/profiles", env, { uuid }, {
  authenticated: true,
  timeoutMs: 12_000,
});

// fetchSkyBlockItemNameMap
const payload = await fetchHypixelJson("/v2/resources/skyblock/items", env, {}, {
  authenticated: false,
});

// fetchCollectionResource
const payload = await fetchHypixelJson("/v2/resources/skyblock/collections", env, {}, {
  authenticated: false,
  timeoutMs: 8_000,
});

// fetchSkillResource
const payload = await fetchHypixelJson("/v2/resources/skyblock/skills", env, {}, {
  authenticated: false,
  timeoutMs: 8_000,
});
```

In `src/routes/player.js`, remove `cacheSeconds: 60,` from the bingo, garden, and museum calls, leaving `{ authenticated: true }`.

In `src/routes/market.js`, remove `cacheSeconds: 15,` (two bazaar calls), `cacheSeconds: 0,` (two auction-page calls), `cacheSeconds: 20,` (auction lookup), and `cacheSeconds: 20,` (ended auctions). Where only `authenticated` remains, keep `{ authenticated: false }` or `{ authenticated: true }` as it was.

In `src/routes/misc.js`, delete the line:

```js
const cacheSeconds = kind === "election" ? 60 : kind === "bingo" ? 300 : 21_600;
```

and remove `cacheSeconds,` from the `handleResources` call and `cacheSeconds: kind === "news" ? 300 : 60,` from the `handleFeed` call.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS. `ok - cache` plus all previously passing suites.

- [ ] **Step 7: Verify no `cacheSeconds` call sites remain**

Run: `grep -rn "cacheSeconds" src/`
Expected: matches only inside `src/hypixel.js` (the internal `options.cacheSeconds` plumbing in `fetchJsonUpstream`). Zero matches in `src/routes/`.

Run: `grep -rn "persistentCache\|caches.default" src/`
Expected: no output.

- [ ] **Step 8: Deploy dry-run and commit**

Run: `npm run deploy:dry`
Expected: success.

```bash
git add src/hypixel.js src/routes/player.js src/routes/market.js src/routes/misc.js scripts/tests/cache.test.mjs
git commit -m "fix(worker): centralize cache policy, stop caching player data

TTLs were scattered across four route files as cacheSeconds arguments,
which is how player museum/garden/bingo drifted to a 60s cache against
the AGENTS.md rule that player data is never cached and the matching
public promise in /privacy. One CACHE_POLICY map keyed by upstream
path, defaulting to 0, makes caching opt-in and auditable in one place.

Market data (bazaar, auctions, ended, lookup) drops to 0: it changes
too fast for staleness to be worth the saved request. Only static ID
and threshold tables stay cached.

Deletes the persistentCache branch. It was unreachable, since
fetchHypixelJson never passed the flag, and had it ever been wired it
would have written player profiles to Cloudflare's edge cache. No
Cloudflare cache is configured.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Pin the `sanitize` truncation contract

`sanitize` silently drops data: `"[omitted]"` past depth, arrays sliced at 250, objects at `maxEntries`, strings clamped at 2000. `AGENTS.md` requires explicit completeness indicators. It is also consumed by every module, so its signature must be fixed here — before lanes build against it concurrently.

The fourth parameter is optional and omitting it preserves today's exact behavior, so this change is backward compatible.

**Files:**
- Modify: `src/util.js:68-85`
- Test: `scripts/tests/util.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `sanitize(value, depth = 5, maxEntries = 300, report = null)` and `createTruncationReport()` from `src/util.js`. Report shape: `{ truncated: boolean, reasons: string[] }` where `reasons` draws from `"depth"`, `"array"`, `"object"`, `"string"`.

- [ ] **Step 1: Write the failing test**

Replace `scripts/tests/util.test.mjs`:

```js
import assert from "node:assert/strict";
import { createTruncationReport, sanitize } from "../../src/util.js";

export async function run() {
  // Omitting the report preserves existing behavior exactly.
  assert.deepEqual(sanitize({ a: 1 }), { a: 1 });
  assert.equal(sanitize({ a: { b: { c: 1 } } }, 2).a.b, "[omitted]");

  // Untruncated input leaves the report clean.
  const clean = createTruncationReport();
  sanitize({ a: 1, b: "short" }, 5, 300, clean);
  assert.equal(clean.truncated, false);
  assert.deepEqual(clean.reasons, []);

  // Depth cutoff is reported.
  const depth = createTruncationReport();
  sanitize({ a: { b: { c: 1 } } }, 2, 300, depth);
  assert.equal(depth.truncated, true);
  assert.deepEqual(depth.reasons, ["depth"]);

  // Array slicing is reported.
  const array = createTruncationReport();
  const sliced = sanitize(Array.from({ length: 300 }, (_, i) => i), 5, 300, array);
  assert.equal(sliced.length, 250);
  assert.equal(array.truncated, true);
  assert.deepEqual(array.reasons, ["array"]);

  // Object entry slicing is reported.
  const object = createTruncationReport();
  sanitize(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i])), 5, 4, object);
  assert.equal(object.truncated, true);
  assert.deepEqual(object.reasons, ["object"]);

  // String clamping is reported.
  const string = createTruncationReport();
  sanitize({ long: "x".repeat(2_500) }, 5, 300, string);
  assert.equal(string.truncated, true);
  assert.deepEqual(string.reasons, ["string"]);

  // Reasons are deduplicated, not repeated per occurrence.
  const many = createTruncationReport();
  sanitize([Array.from({ length: 300 }), Array.from({ length: 300 })], 5, 300, many);
  assert.deepEqual(many.reasons, ["array"]);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `not ok - util`, `does not provide an export named 'createTruncationReport'`.

- [ ] **Step 3: Implement**

In `src/util.js`, replace the `sanitize` function with:

```js
export function createTruncationReport() {
  return { truncated: false, reasons: [] };
}

function noteTruncation(report, reason) {
  if (!report) return;
  report.truncated = true;
  if (!report.reasons.includes(reason)) report.reasons.push(reason);
}

export function sanitize(value, depth = 5, maxEntries = 300, report = null) {
  if (value === null || value === undefined) return value ?? null;
  if (depth <= 0) {
    noteTruncation(report, "depth");
    return "[omitted]";
  }
  if (["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "string" && value.length > 2_000) {
      noteTruncation(report, "string");
      return `${value.slice(0, 2_000)}…`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const cap = Math.min(maxEntries, 250);
    if (value.length > cap) noteTruncation(report, "array");
    return value.slice(0, cap).map((item) => sanitize(item, depth - 1, maxEntries, report));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > maxEntries) noteTruncation(report, "object");
    const result = {};
    for (const [key, item] of entries.slice(0, maxEntries)) {
      result[key] = sanitize(item, depth - 1, maxEntries, report);
    }
    return result;
  }
  return String(value);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, `ok - util`. All other suites still pass, proving the change is backward compatible.

- [ ] **Step 5: Commit**

```bash
git add src/util.js scripts/tests/util.test.mjs
git commit -m "feat(util): add opt-in truncation reporting to sanitize

sanitize silently dropped data in four ways: depth cutoff, array slice,
object entry slice, and string clamp. AGENTS.md requires explicit
completeness indicators, so callers need a way to know.

Fourth parameter is optional and omitting it preserves current
behavior exactly, keeping every existing caller working untouched.

Pinned before the concurrent lanes start: sanitize is consumed by every
module, so its signature must not move while lanes build against it.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 — four lanes (concurrent)

**Ownership is strict. A lane MUST NOT edit a file it does not own.**

| Lane | Owns |
|---|---|
| B | `src/routes/market.js`, `src/market.js`, `scripts/tests/market.test.mjs` |
| C | `src/items.js`, `src/util.js`, `scripts/tests/items.test.mjs` |
| D | `src/sections.js`, `src/routes/player.js`, `scripts/tests/sections.test.mjs` |
| E | `src/levels.js`, `scripts/tests/levels.test.mjs` |

Nobody edits `scripts/test-worker.mjs` (Task 1 pre-registered every suite), `actions/`, or `gpt/`.

---

### Task 4 (Lane B): Sort before decode, and an honest segment contract

Two changes to one function. `starting_bid` is a plain JSON field, so price is knowable without decoding — sorting first and decoding lazily from cheapest upward gives identical output for roughly 10-20 decodes instead of 100.

Cloudflare error 1102 is **not catchable**: CPU exhaustion kills the isolate, no handler runs. Guard proactively with a decode counter — a counter, not a timer, since `Date.now()` does not advance between I/O in Workers.

**Files:**
- Modify: `src/routes/market.js:109-172` (`handleAuctionPage`), `:174-315` (`handleLowestBin`)
- Test: `scripts/tests/market.test.mjs`

**Interfaces:**
- Consumes: `binPrice(auction)`, `auctionPrice(auction)`, `skyBlockItemIdsMatch(left, right)`, `compactAuction(auction, full)` from `src/market.js`; `decodeInventoryBlob(blob)` from `src/items.js`. All unchanged.
- Produces: `/v1/auctions/lowest-bin` response gains `scan.segments_required`, `scan.segment_index`, `scan.decodes_performed`, `scan.decode_budget_exhausted`, `match_count_is_lower_bound`. Removes `scan.candidate_decode_truncated`. `match_count_in_segment` narrows to a lower bound.

- [ ] **Step 1: Write the failing test**

Append to the `run()` body in `scripts/tests/market.test.mjs`, after the existing assertions:

```js
  // Realistic AH: 90 upstream pages against a 4-page cap. This is production.
  // The old fixture only ever mocked totalPages: 2, which is why the
  // permanently-false `complete` flag went unnoticed.
  installMockFetch({
    "/v2/skyblock/auctions": (url) => {
      const page = Number(url.searchParams.get("page") || 0);
      return Response.json({
        success: true,
        page,
        totalPages: 90,
        totalAuctions: 90_000,
        lastUpdated: 456,
        auctions: [auction(`p${page}`, 1_000 + page)],
      });
    },
  });

  const big = await (await call("/v1/auctions/lowest-bin?item=RED_ROSE%3A3")).json();
  assert.equal(big.data.scan.complete, false, "4-page cap cannot cover 90 pages");
  assert.equal(big.data.authoritative_lowest_bin, null);
  assert.equal(big.data.scan.segments_required, 23, "ceil(90 / 4)");
  assert.equal(big.data.scan.segment_index, 0);
  assert.equal(big.data.scan.next_start_page, 4);
  assert.equal(big.data.segment_lowest_bin.bin_price, 1_000);

  // Segment 2 reports its index and keeps segments_required stable.
  const second = await (await call("/v1/auctions/lowest-bin?item=RED_ROSE%3A3&start_page=4")).json();
  assert.equal(second.data.scan.segment_index, 1);
  assert.equal(second.data.scan.segments_required, 23);
  assert.equal(second.data.scan.next_start_page, 8);
  assert.equal(second.data.segment_lowest_bin.bin_price, 1_004);

  // Lazy decode: stop once `limit` cheap matches are confirmed. With limit=1
  // over 4 pages of matching auctions, only one decode should happen.
  const lazy = await (await call("/v1/auctions/lowest-bin?item=RED_ROSE%3A3&limit=1")).json();
  assert.equal(lazy.data.auctions.length, 1);
  assert.equal(lazy.data.scan.decodes_performed, 1, "must not decode past the limit");
  assert.equal(lazy.data.scan.decode_budget_exhausted, false);
  assert.equal(lazy.data.match_count_is_lower_bound, true);

  // The retired eager-decode cap is gone.
  assert.equal(lazy.data.scan.candidate_decode_truncated, undefined);
```

Add `auction` to the import at the top of the file:

```js
import { auction, call, installMockFetch } from "./_fixtures.mjs";
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `not ok - market`, `Expected values to be strictly equal: undefined !== 23` on `segments_required`.

- [ ] **Step 3: Rewrite the scan core**

In `src/routes/market.js`, inside `handleLowestBin`, replace everything from `const nameNeedle = normalizeItemSearchText(target.name);` down to and including `matches.sort((left, right) => binPrice(left.auction) - binPrice(right.auction));` with:

```js
  const nameNeedle = normalizeItemSearchText(target.name);
  const decodeBudget = 60;
  const candidates = [];
  let candidateCount = 0;
  let pagesScanned = 0;
  let snapshotConsistent = snapshotLastUpdated !== null;
  const collectCandidates = (payload) => {
    pagesScanned += 1;
    if (optionalNumber(payload.lastUpdated) !== snapshotLastUpdated) snapshotConsistent = false;
    for (const auction of Array.isArray(payload.auctions) ? payload.auctions : []) {
      if (auction.bin !== true) continue;
      if (category && String(auction.category || "").toLowerCase() !== category) continue;
      if (tier && String(auction.tier || "").toLowerCase() !== tier) continue;
      const searchableName = normalizeItemSearchText(`${auction.item_name || ""} ${auction.extra || ""}`);
      if (!searchableName.includes(nameNeedle)) continue;
      candidateCount += 1;
      candidates.push(auction);
    }
  };
  collectCandidates(firstPayload);
  const remainingPayloads = await Promise.all(remainingPages.map((page) =>
    fetchHypixelJson("/v2/skyblock/auctions", env, { page }, { authenticated: false })
  ));
  for (const payload of remainingPayloads) collectCandidates(payload);

  // Price is a plain JSON field, so sort before decoding and decode only from
  // the cheapest upward. The route answers "what is cheapest", so it can stop
  // as soon as it has `limit` confirmed matches. This is ~10-20 decodes rather
  // than every candidate, and each decode is base64 + gzip + a full NBT walk.
  candidates.sort((left, right) => binPrice(left) - binPrice(right));

  let decodesPerformed = 0;
  let decodeFailures = 0;
  const matches = [];
  for (const auction of candidates) {
    if (matches.length >= limit) break;
    if (decodesPerformed >= decodeBudget) break;
    decodesPerformed += 1;
    const decoded = await decodeInventoryBlob(auction.item_bytes);
    const item = decoded.records[0]?.summary || null;
    if (decoded.error || !item?.skyblock_id) {
      decodeFailures += 1;
      continue;
    }
    if (!skyBlockItemIdsMatch(item.skyblock_id, target.id)) continue;
    matches.push({ auction, item });
  }
  // Candidates were sorted ascending and walked in order, so matches already are.
  const decodeBudgetExhausted = decodesPerformed >= decodeBudget && matches.length < limit;
```

- [ ] **Step 4: Rewrite the response block**

Replace everything from `const cheapestMatches = await Promise.all(` to the end of `handleLowestBin` with:

```js
  const cheapestMatches = await Promise.all(matches.slice(0, limit).map(async ({ auction, item }) => ({
    ...await compactAuction(auction, false),
    bin_price: binPrice(auction),
    verified_item: item,
  })));
  const segmentLowestBin = cheapestMatches[0] || null;
  const coversAllPages = startPage === 0 && endPageExclusive >= totalPages;
  const complete = coversAllPages && snapshotConsistent && !decodeBudgetExhausted && decodeFailures === 0;

  return json({
    success: true,
    data: {
      source: "Hypixel Public API",
      target: {
        requested: requestedItem,
        item_id: target.id,
        name: target.name,
      },
      filters: {
        bin_only: true,
        category: category || null,
        tier: tier || null,
      },
      scan: {
        snapshot_last_updated: snapshotLastUpdated,
        snapshot_consistent: snapshotConsistent,
        expected_last_updated: expectedLastUpdated,
        total_upstream_pages: totalPages,
        start_page: startPage,
        pages_scanned: pagesScanned,
        scanned_through_page: endPageExclusive - 1,
        next_start_page: endPageExclusive < totalPages ? endPageExclusive : null,
        segments_required: Math.ceil(totalPages / maxPages),
        segment_index: Math.floor(startPage / maxPages),
        covers_all_pages: coversAllPages,
        complete,
        name_prefilter_candidates: candidateCount,
        decodes_performed: decodesPerformed,
        decode_budget: decodeBudget,
        decode_budget_exhausted: decodeBudgetExhausted,
        decode_failures: decodeFailures,
      },
      match_count_in_segment: matches.length,
      match_count_is_lower_bound: true,
      price_order: "ascending",
      segment_lowest_bin: segmentLowestBin,
      authoritative_lowest_bin: complete ? segmentLowestBin : null,
      auctions: cheapestMatches,
      warning: complete
        ? null
        : "This scan is not yet authoritative. Continue from next_start_page using the same expected_last_updated, keeping the lowest segment_lowest_bin seen so far, or restart if the snapshot changed.",
    },
  });
```

`match_count_is_lower_bound` is always `true`: lazy decoding stops early, so the scan never learns how many pricier matches existed. The field's real consumer is the cheapest-price question, which lazy decoding still answers exactly. `name_prefilter_candidates` remains the exact pre-decode population.

- [ ] **Step 5: Precompute sort keys in `handleAuctionPage`**

`auctionPrice` was recomputed inside comparators, so an ~1000-record sort called it O(n log n) times. In `src/routes/market.js`, replace:

```js
  if (sort === "ending") records.sort((left, right) => number(left.end) - number(right.end));
  if (sort === "price" || sort === "price_asc") records.sort((left, right) => auctionPrice(left) - auctionPrice(right));
  if (sort === "price_desc") records.sort((left, right) => auctionPrice(right) - auctionPrice(left));
  const pageLowestBinAuction = [...records]
    .filter((auction) => auction.bin === true)
    .sort((left, right) => binPrice(left) - binPrice(right))[0] || null;
```

with:

```js
  if (sort === "ending") {
    records.sort((left, right) => number(left.end) - number(right.end));
  } else if (sort === "price" || sort === "price_asc" || sort === "price_desc") {
    const priceOf = new Map(records.map((auction) => [auction, auctionPrice(auction)]));
    records.sort((left, right) => sort === "price_desc"
      ? priceOf.get(right) - priceOf.get(left)
      : priceOf.get(left) - priceOf.get(right));
  }
  const binRecords = records.filter((auction) => auction.bin === true);
  const binPriceOf = new Map(binRecords.map((auction) => [auction, binPrice(auction)]));
  const pageLowestBinAuction = [...binRecords]
    .sort((left, right) => binPriceOf.get(left) - binPriceOf.get(right))[0] || null;
```

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: PASS, `ok - market`. The original `totalPages: 2` case still asserts `complete: true`, proving completeness works when genuinely reachable.

- [ ] **Step 7: Deploy dry-run and commit**

Run: `npm run deploy:dry`
Expected: success.

```bash
git add src/routes/market.js scripts/tests/market.test.mjs
git commit -m "perf(auctions): sort before decode, report honest segments

Lowest-BIN decoded up to 100 candidates, then sorted by price, then
returned the cheapest few. starting_bid is a plain JSON field, so price
never needed a decode. Sorting first and decoding lazily from cheapest
upward gives identical output for ~10-20 decodes instead of 100. Each
decode is base64 + gzip + a full NBT tree walk.

Retires the 100-candidate cap and candidate_decode_truncated, which
existed only because decoding was eager. A decode budget replaces them
for the pathological case where the name prefilter matches many
auctions but few match the exact item ID. Budget is a counter, not a
timer: Date.now() does not advance between I/O in Workers, and CPU
exhaustion (Cloudflare 1102) kills the isolate rather than raising a
catchable error, so the guard must be proactive.

scan.complete was unreachable in production: the 4-page cap cannot
cover ~90 live AH pages, so authoritative_lowest_bin was always null.
Tests only mocked totalPages: 2, which hid it. Adds segments_required
and segment_index so the GPT can merge segments and legitimately
declare a global lowest BIN. Product rule 6 still holds: no page-local
minimum is ever called global.

match_count_in_segment narrows to a lower bound, since lazy decoding
stops before learning the true count.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5 (Lane C): Fix container classification and item truncation

`backpack_icons` blobs match `/backpack/` and surface as fake containers in the inventory index. `mapInBatches` is declared, never used, never exported.

**Files:**
- Modify: `src/items.js:45-83` (`findNbtContainers`), `:115-132` (`inventoryContainerKind`), `:229-262` (`compactNbtItem`)
- Modify: `src/util.js:1-7` (delete `mapInBatches`)
- Test: `scripts/tests/items.test.mjs`

**Interfaces:**
- Consumes: `sanitize`, `createTruncationReport` from `src/util.js` (Task 3).
- Produces: `findNbtContainers(member)` no longer returns `backpack_icons` entries. `compactNbtItem` output gains `attributes_truncated: boolean` and `enchantments_truncated: boolean`.

- [ ] **Step 1: Write the failing test**

Replace `scripts/tests/items.test.mjs`:

```js
import assert from "node:assert/strict";
import { findNbtContainers } from "../../src/items.js";
import { itemNbt } from "./_fixtures.mjs";

export async function run() {
  // A factory, not a shared object: findNbtContainers guards recursion with a
  // `visited` WeakSet keyed by identity, so reusing one blob reference across
  // containers would make it skip all but the first. Real payloads come from
  // JSON.parse, which yields a distinct object per container.
  const blob = () => ({ type: 0, data: itemNbt });
  const containers = findNbtContainers({
    inventory: {
      inv_contents: blob(),
      backpack_contents: { 0: blob() },
      backpack_icons: { 0: blob() },
    },
  });
  const ids = containers.map((entry) => entry.id);

  assert.ok(ids.includes("inventory.inv_contents"), "main inventory must be indexed");
  assert.ok(ids.includes("inventory.backpack_contents.0"), "real backpacks must be indexed");
  assert.ok(
    !ids.some((id) => id.includes("backpack_icons")),
    "backpack_icons are display icons, not containers",
  );
  assert.equal(
    containers.filter((entry) => entry.kind === "backpack").length,
    1,
    "only the real backpack counts",
  );
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `not ok - items`, `backpack_icons are display icons, not containers`.

- [ ] **Step 3: Classify icons distinctly**

In `src/items.js`, in `inventoryContainerKind`, add the icons check **before** the backpack check — `"backpack_icons"` contains `"backpack"`, so order decides:

```js
function inventoryContainerKind(path) {
  const value = path.toLowerCase();
  if (/talisman|accessor/.test(value)) return "accessory_bag";
  if (/inv_armor|\.armor/.test(value)) return "armor";
  if (/equipment/.test(value)) return "equipment";
  if (/wardrobe/.test(value)) return "wardrobe";
  if (/ender_chest/.test(value)) return "ender_chest";
  if (/backpack_icons?/.test(value)) return "backpack_icon";
  if (/backpack/.test(value)) return "backpack";
  if (/personal_vault|vault/.test(value)) return "personal_vault";
  if (/fishing_bag/.test(value)) return "fishing_bag";
  if (/potion_bag/.test(value)) return "potion_bag";
  if (/quiver/.test(value)) return "quiver";
  if (/candy/.test(value)) return "candy_bag";
  if (/sacks?_bag/.test(value)) return "sacks_bag";
  if (/inv_contents/.test(value)) return "inventory";
  if (/bag/.test(value)) return "bag";
  return "other";
}
```

- [ ] **Step 4: Exclude icons from the index**

In `src/items.js`, in `findNbtContainers`, change the final return to drop them:

```js
  return [...found.values()]
    .filter((entry) => entry.kind !== "backpack_icon")
    .sort((left, right) => left.id.localeCompare(right.id));
```

Add `backpack_icon: "Backpack Icon",` to the `labels` map in `inventoryContainerLabel` so the kind always resolves to a label, even though it is filtered from the index.

- [ ] **Step 5: Report item modifier truncation**

In `src/items.js`, in `compactNbtItem`, replace the `attributes` and `enchantments` fields:

```js
  const attributeKeys = extra.attributes && typeof extra.attributes === "object"
    ? Object.keys(extra.attributes)
    : [];
  const enchantmentKeys = extra.enchantments && typeof extra.enchantments === "object"
    ? Object.keys(extra.enchantments)
    : [];

  return {
    slot,
    name: name || "Unknown item",
    skyblock_id: skyblockId,
    count: optionalNumber(item.Count) ?? 1,
    reforge: stringOrNull(extra.modifier),
    stars: optionalNumber(extra.upgrade_level ?? extra.dungeon_item_level),
    recombobulated: number(extra.rarity_upgrades) > 0,
    attributes: attributeKeys.slice(0, 20),
    attributes_truncated: attributeKeys.length > 20,
    enchantments: enchantmentKeys.slice(0, 50),
    enchantments_truncated: enchantmentKeys.length > 50,
  };
```

- [ ] **Step 6: Delete dead code**

In `src/util.js`, delete lines 1-7 in their entirety:

```js
async function mapInBatches(values, batchSize, mapper) {
  const results = [];
  for (let index = 0; index < values.length; index += batchSize) {
    results.push(...await Promise.all(values.slice(index, index + batchSize).map(mapper)));
  }
  return results;
}
```

- [ ] **Step 7: Verify it is truly dead**

Run: `grep -rn "mapInBatches" src/ scripts/`
Expected: no output.

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: PASS, `ok - items`.

- [ ] **Step 9: Deploy dry-run and commit**

Run: `npm run deploy:dry`
Expected: success.

```bash
git add src/items.js src/util.js scripts/tests/items.test.mjs
git commit -m "fix(inventory): stop indexing backpack_icons as containers

backpack_icons holds display icons, but the path matched /backpack/ and
each icon surfaced as a fake backpack in the inventory index. The icons
check now runs before the backpack check, since backpack_icons contains
backpack and order decides the match.

Item modifiers now report truncation: attributes capped at 20 and
enchantments at 50 were silently sliced, and AGENTS.md requires
explicit completeness indicators.

Deletes mapInBatches, which was declared but never used or exported.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6 (Lane D): Fix nested stat filtering and museum blobs

`filterNumericStats` tests keys against a regex then requires a scalar value — but `player_stats` is nested, so `kills` matches `/kill/` and is then dropped for being an object. Per-category `lifetime_counters` come back near-empty.

`compactMuseum` never decodes item blobs, so `sanitize` clamps each base64 string at 2000 chars: token waste, no reforge or stars visible.

**Files:**
- Modify: `src/sections.js:58-109` (`compactMuseum`), `:822-831` (`filterNumericStats`)
- Modify: `src/routes/player.js:331` (await the now-async `compactMuseum`)
- Test: `scripts/tests/sections.test.mjs`

**Interfaces:**
- Consumes: `decodeInventoryBlob(blob)` from `src/items.js`; `paginateRecords`, `sanitize`, `optionalNumber` from `src/util.js`.
- Produces: `compactMuseum(profileData, query, page, limit)` becomes **async** — `handlePlayerExtra` must `await` it. Museum entries gain `item` (decoded summary or `null`) and `decode_error`, and drop the raw `data` blob. `filterNumericStats(stats, pattern, limit)` keys results by dotted path.

- [ ] **Step 1: Write the failing test**

Replace `scripts/tests/sections.test.mjs`:

```js
import assert from "node:assert/strict";
import { call, installMockFetch, playerUuid } from "./_fixtures.mjs";

export async function run() {
  // player_stats is nested. The old filter tested the key `kills` against
  // /kill/, then dropped it because its value is an object.
  installMockFetch({
    "/v2/skyblock/profiles": () => Response.json({
      success: true,
      profiles: [{
        profile_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        cute_name: "Mango",
        selected: true,
        members: {
          [playerUuid]: {
            last_save: 100,
            player_stats: {
              kills: { total: 5_000, zombie: 1_200 },
              deaths: { total: 40 },
              highest_critical_damage: 1_000_000,
              mining: { ores_mined: 900 },
              auctions: { created: 3 },
            },
          },
        },
      }],
    }),
  });

  const response = await call(`/v1/player/section?uuid=${playerUuid}&section=stats`);
  const stats = await response.json();
  assert.equal(response.status, 200, JSON.stringify(stats));

  const combat = stats.data.combat.lifetime_counters;
  assert.equal(combat["kills.total"], 5_000, "nested kill counters must be reached");
  assert.equal(combat["kills.zombie"], 1_200);
  assert.equal(combat["deaths.total"], 40);
  assert.equal(combat.highest_critical_damage, 1_000_000, "scalars must still work");

  const mining = stats.data.mining.lifetime_counters;
  assert.equal(mining["mining.ores_mined"], 900);
  assert.equal(mining["kills.total"], undefined, "category regexes must still scope");

  // Museum decodes the paginated page and never ships raw base64.
  installMockFetch();
  const museumResponse = await call(`/v1/player/extra?uuid=${playerUuid}&kind=museum`);
  const museum = await museumResponse.json();
  assert.equal(museumResponse.status, 200, JSON.stringify(museum));

  // The museum key is the donated item's ID; the blob is its NBT. The shared
  // fixture blob decodes to RED_ROSE:3 ("Azure Bluet") — verified, not assumed.
  const entry = museum.data.items[0];
  assert.equal(entry.item_id, "ZOMBIE_SWORD", "museum key is preserved");
  assert.equal(entry.item.skyblock_id, "RED_ROSE:3", "page items must be decoded");
  assert.equal(entry.item.name, "Azure Bluet");
  assert.equal(entry.decode_error, null);
  assert.equal(entry.data, undefined, "raw blob must not ship");
  assert.equal(entry.blob, undefined, "internal blob ref must not ship");
  assert.equal(museum.data.members[0].value, 1234);
  assert.equal(museum.data.members[0].total_entries, 2, "one items entry plus one special");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `not ok - sections`, `nested kill counters must be reached`, `undefined !== 5000`.

- [ ] **Step 3: Walk nested stats**

In `src/sections.js`, replace `filterNumericStats`. The pattern now tests the full dotted path, so `kills.total` matches `/kill/`:

```js
function filterNumericStats(stats, pattern, limit = 160) {
  const result = {};
  const walk = (value, prefix, depth) => {
    if (depth > 4) return;
    for (const [key, item] of Object.entries(value)) {
      if (Object.keys(result).length >= limit) return;
      const path = prefix ? `${prefix}.${key}` : key;
      if (item && typeof item === "object" && !Array.isArray(item)) {
        walk(item, path, depth + 1);
      } else if (["number", "boolean", "string"].includes(typeof item) && pattern.test(path)) {
        result[path] = item;
      }
    }
  };
  walk(objectOrEmpty(stats), "", 0);
  return result;
}
```

- [ ] **Step 4: Decode the museum page, not the whole museum**

In `src/sections.js`, replace `compactMuseum` entirely. Entries are collected without decoding, filtered, paginated, and only then decoded — so cost scales with page size (≤40), not museum size:

```js
export async function compactMuseum(profileData, query, page, limit) {
  const members = [];
  const entries = [];
  for (const [memberUuid, rawMuseum] of Object.entries(objectOrEmpty(profileData))) {
    const museum = objectOrEmpty(rawMuseum);
    const memberEntries = [];
    for (const [itemId, itemData] of Object.entries(objectOrEmpty(museum.items))) {
      memberEntries.push({
        member_uuid: normalizeUuid(memberUuid),
        source: "items",
        item_id: itemId,
        donated_time: optionalNumber(itemData?.donated_time),
        blob: itemData?.items ?? null,
      });
    }
    for (const [index, special] of (Array.isArray(museum.special) ? museum.special : []).entries()) {
      memberEntries.push({
        member_uuid: normalizeUuid(memberUuid),
        source: "special",
        special_index: index,
        item_id: null,
        donated_time: optionalNumber(special?.donated_time),
        blob: special?.items ?? null,
      });
    }
    members.push({
      member_uuid: normalizeUuid(memberUuid),
      value: optionalNumber(museum.value),
      appraisal: museum.appraisal ?? null,
      total_entries: memberEntries.length,
    });
    entries.push(...memberEntries);
  }

  // Query matches identifiers only. It previously ran over JSON.stringify of the
  // entry, which meant it searched truncated base64 — never a useful match.
  const filtered = entries.filter((entry) => !query ||
    `${entry.item_id || ""} ${entry.source} ${entry.member_uuid}`.toLowerCase().includes(query));
  const pagination = paginateRecords(filtered, page, limit);

  // Decode only this page. Museums hold hundreds of items; decoding all of them
  // would be base64 + gzip + a full NBT walk each.
  const items = await Promise.all(pagination.items.map(async ({ blob, ...entry }) => {
    if (!blob) return { ...entry, item: null, decode_error: null };
    const decoded = await decodeInventoryBlob(blob);
    return {
      ...entry,
      item: decoded.records[0]?.summary || null,
      decode_error: decoded.error,
    };
  }));

  return {
    members,
    query: query || null,
    ...pagination,
    items,
  };
}
```

- [ ] **Step 5: Import the decoder**

In `src/sections.js`, add `decodeInventoryBlob` to the existing import from `./items.js`:

```js
import {
  cleanItemName,
  compactAccessories,
  compactGear,
  decodeInventoryBlob,
  formatItemId,
} from "./items.js";
```

- [ ] **Step 6: Await the now-async museum builder**

In `src/routes/player.js`, in `handlePlayerExtra`, change:

```js
  const museum = compactMuseum(payload.profile || {}, query, page, limit);
```

to:

```js
  const museum = await compactMuseum(payload.profile || {}, query, page, limit);
```

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: PASS, `ok - sections`.

- [ ] **Step 8: Deploy dry-run and commit**

Run: `npm run deploy:dry`
Expected: success.

```bash
git add src/sections.js src/routes/player.js scripts/tests/sections.test.mjs
git commit -m "fix(sections): reach nested player_stats, decode museum pages

player_stats is nested: kills, deaths and auctions are objects. The
filter tested the key against its regex, then dropped the entry for not
being a scalar, so per-category lifetime_counters came back near-empty
while the section-level dump duplicated everything. Now walks nested
objects and keys results by dotted path, so kills.total matches /kill/.
No fixture covered player_stats, which is why this survived.

Museum never decoded item blobs, so sanitize clamped each base64 string
at 2000 chars: pure token waste with no reforge or stars visible. Now
paginates first and decodes only that page, keeping cost tied to page
size rather than museum size.

Museum query matches identifiers instead of JSON.stringify of the
entry, which had been searching truncated base64.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7 (Lane E): Build the level-ladder engine

Greenfield module, no consumers until Phase 2. This task builds and tests the **lookup logic only**, against synthetic ladders. Real ladder data is Task 8 — it must be sourced, not recalled.

**Files:**
- Create: `src/levels.js`
- Test: `scripts/tests/levels.test.mjs`

**Interfaces:**
- Consumes: `optionalNumber`, `round` from `src/util.js`.
- Produces: `levelFromLadder(experience, ladder, options)` from `src/levels.js`, where `ladder` is an ascending array of cumulative XP thresholds and `options` is `{ maxLevel?: number, tableVersion: string }`. Returns `{ experience, level, level_with_progress, max_level, xp_into_level, xp_for_next_level, progress_to_next_level, level_source, table_version, verify_on_wiki }` or an unavailable shape when `experience` is null.

- [ ] **Step 1: Write the failing test**

Replace `scripts/tests/levels.test.mjs`:

```js
import assert from "node:assert/strict";
import { levelFromLadder } from "../../src/levels.js";

export async function run() {
  // Cumulative thresholds: level 1 at 100, level 2 at 300, level 3 at 600.
  const ladder = [100, 300, 600];
  const options = { maxLevel: 3, tableVersion: "test-1" };

  // Below the first threshold is level 0, not level 1.
  const zero = levelFromLadder(50, ladder, options);
  assert.equal(zero.level, 0);
  assert.equal(zero.xp_into_level, 50);
  assert.equal(zero.xp_for_next_level, 100);
  assert.equal(zero.progress_to_next_level, 0.5);

  // Exactly on a threshold counts as achieved.
  assert.equal(levelFromLadder(100, ladder, options).level, 1);
  assert.equal(levelFromLadder(299, ladder, options).level, 1);
  assert.equal(levelFromLadder(300, ladder, options).level, 2);

  // Mid-level progress is measured within the current band.
  const mid = levelFromLadder(400, ladder, options);
  assert.equal(mid.level, 2);
  assert.equal(mid.xp_into_level, 100, "400 - 300");
  assert.equal(mid.xp_for_next_level, 300, "600 - 300");
  assert.equal(mid.level_with_progress, 2.3333);

  // At max: no next level, progress saturates, overflow XP is preserved.
  const max = levelFromLadder(900, ladder, options);
  assert.equal(max.level, 3);
  assert.equal(max.max_level, 3);
  assert.equal(max.xp_for_next_level, null);
  assert.equal(max.progress_to_next_level, 1);
  assert.equal(max.xp_into_level, 300, "overflow past the cap is kept");
  assert.equal(max.level_with_progress, 3);

  // Provenance rides on every derived level: this data came from no API.
  assert.equal(max.level_source, "static_table");
  assert.equal(max.table_version, "test-1");
  assert.equal(max.verify_on_wiki, true);

  // Missing XP is unavailable, never zero (AGENTS.md rule 5).
  const missing = levelFromLadder(null, ladder, options);
  assert.equal(missing.level, null);
  assert.equal(missing.experience, null);
  assert.equal(missing.available, false);

  // An empty ladder cannot derive anything and must say so.
  const empty = levelFromLadder(500, [], options);
  assert.equal(empty.level, null);
  assert.equal(empty.available, false);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `not ok - levels`, `Cannot find module '../../src/levels.js'`.

- [ ] **Step 3: Implement the engine**

Create `src/levels.js`:

```js
import { optionalNumber, round } from "./util.js";

// Hypixel publishes level thresholds for skills only, via
// /v2/resources/skyblock/skills. Slayer, catacombs, dungeon classes and pets
// have no resource endpoint, so their ladders are static tables transcribed
// from the official wiki. That makes this the one place the Worker reports a
// number no API gave it, so every derived level carries provenance:
// level_source, table_version, and verify_on_wiki.

function unavailable(experience, tableVersion) {
  return {
    available: false,
    experience: experience ?? null,
    level: null,
    level_with_progress: null,
    max_level: null,
    xp_into_level: null,
    xp_for_next_level: null,
    progress_to_next_level: null,
    level_source: "static_table",
    table_version: tableVersion,
    verify_on_wiki: true,
  };
}

/**
 * Resolve a level from an ascending array of cumulative XP thresholds.
 *
 * @param {number|null} experience Total accumulated XP, or null when the API did not expose it.
 * @param {number[]} ladder Cumulative XP required to reach level 1, 2, 3, ...
 * @param {{ maxLevel?: number, tableVersion: string }} options
 */
export function levelFromLadder(experience, ladder, options) {
  const tableVersion = options?.tableVersion || "unknown";
  const xp = optionalNumber(experience);
  if (xp === null || !Array.isArray(ladder) || !ladder.length) {
    return unavailable(xp, tableVersion);
  }

  const maxLevel = optionalNumber(options?.maxLevel) ?? ladder.length;
  let level = 0;
  let currentThreshold = 0;
  let nextThreshold = null;

  for (const [index, threshold] of ladder.entries()) {
    if (xp < threshold) {
      nextThreshold = threshold;
      break;
    }
    level = index + 1;
    currentThreshold = threshold;
  }

  const cappedLevel = Math.min(level, maxLevel);
  const atMax = cappedLevel >= maxLevel || nextThreshold === null;
  const xpIntoLevel = Math.max(0, xp - currentThreshold);
  const xpForNextLevel = atMax ? null : nextThreshold - currentThreshold;
  const progress = xpForNextLevel && xpForNextLevel > 0
    ? Math.max(0, Math.min(1, xpIntoLevel / xpForNextLevel))
    : 0;

  return {
    available: true,
    experience: xp,
    level: cappedLevel,
    level_with_progress: round(cappedLevel + (atMax ? 0 : progress), 4),
    max_level: maxLevel,
    xp_into_level: xpIntoLevel,
    xp_for_next_level: xpForNextLevel,
    progress_to_next_level: atMax ? 1 : round(progress, 6),
    level_source: "static_table",
    table_version: tableVersion,
    verify_on_wiki: true,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, `ok - levels`.

- [ ] **Step 5: Commit**

```bash
git add src/levels.js scripts/tests/levels.test.mjs
git commit -m "feat(levels): add XP ladder engine with provenance

Hypixel publishes thresholds for skills only. Slayer, catacombs,
classes and pets have no resource endpoint, so deriving their levels
means a static table transcribed from the wiki. That makes this the one
place the Worker reports a number no API gave it, so every result
carries level_source, table_version and verify_on_wiki.

Engine only: ladder data is transcribed separately and must be sourced,
not recalled. No consumers until the sections are wired in Phase 2.

Missing XP returns available: false rather than level 0, per the rule
that absent data is unavailable and never zero.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8 (Lane E): Transcribe the real ladders

**This task requires sourcing data from the official wiki. Do not write these numbers from memory** — `gpt/knowledge/calculations.md:3` bans reconstructing formulas from recall, and a wrong threshold here silently corrupts every level the Worker reports.

**Files:**
- Modify: `src/levels.js`
- Test: `scripts/tests/levels.test.mjs`

**Interfaces:**
- Consumes: `levelFromLadder` from Task 7.
- Produces: `SLAYER_LADDERS` (keyed by boss ID: `zombie`, `spider`, `wolf`, `enderman`, `blaze`, `vampire`), `CATACOMBS_LADDER`, `DUNGEON_CLASS_LADDER`, `PET_LADDERS` (keyed by rarity), and `TABLE_VERSION` from `src/levels.js`.

- [ ] **Step 1: Source each ladder from the official wiki**

Fetch and read each page on `hypixelskyblock.minecraft.wiki`:

- Slayer XP per boss, all six bosses, every tier
- Catacombs level thresholds, including levels past 50
- Dungeon class thresholds (confirm whether they match Catacombs rather than assuming)
- Pet XP per rarity, including whether GOLDEN_DRAGON uses its own ladder

Record the exact page URL for each. If a page is unreachable or ambiguous, **stop and report it** rather than guessing. A missing ladder is a known gap; a wrong ladder is a silent lie shipped to every user.

- [ ] **Step 2: Write the anchor tests**

Add to `scripts/tests/levels.test.mjs`, using values read from the wiki in Step 1 — not from memory. Assert at minimum, per ladder: the level-1 threshold, one mid ladder threshold, and the max level.

```js
import { CATACOMBS_LADDER, PET_LADDERS, SLAYER_LADDERS, TABLE_VERSION, levelFromLadder } from "../../src/levels.js";

  // Anchors transcribed from the wiki. Each asserts a real threshold so a
  // mistyped ladder fails here rather than silently misreporting a level.
  assert.equal(SLAYER_LADDERS.zombie.length, 9, "zombie slayer has 9 tiers");
  assert.equal(levelFromLadder(0, SLAYER_LADDERS.zombie, { maxLevel: 9, tableVersion: TABLE_VERSION }).level, 0);
  // ...one assertion per sourced anchor value.
```

- [ ] **Step 3: Add the tables**

Add to `src/levels.js`, above `levelFromLadder`, each with its source URL:

```js
// Transcribed from the official Hypixel SkyBlock Wiki. Bump TABLE_VERSION on
// any change, and re-verify against the source page when Hypixel adjusts a
// ladder. Every consumer reports verify_on_wiki: true for this reason.
export const TABLE_VERSION = "2026-07-15";

// Source: <exact wiki URL read in Step 1>
export const SLAYER_LADDERS = { /* sourced cumulative thresholds */ };

// Source: <exact wiki URL read in Step 1>
export const CATACOMBS_LADDER = [ /* sourced cumulative thresholds */ ];

// Source: <exact wiki URL read in Step 1>
export const DUNGEON_CLASS_LADDER = [ /* sourced cumulative thresholds */ ];

// Source: <exact wiki URL read in Step 1>
export const PET_LADDERS = { /* sourced cumulative thresholds per rarity */ };
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, `ok - levels`.

- [ ] **Step 5: Commit**

```bash
git add src/levels.js scripts/tests/levels.test.mjs
git commit -m "feat(levels): transcribe slayer, catacombs, class, pet ladders

Each table cites the wiki page it came from. Anchor tests assert real
thresholds per ladder so a mistyped number fails the suite instead of
silently misreporting every level built on it.

TABLE_VERSION ships in every derived level so a stale table is
identifiable from a response alone.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification

After all Phase 1 lanes merge:

```bash
npm test
npm run deploy:dry
```

Expected: 8 suites pass, dry-run succeeds.

Then confirm the dead code is gone:

```bash
grep -rn "mapInBatches\|persistentCache\|caches.default\|candidate_decode_truncated" src/
```

Expected: no output.

## Deployment

Every task here is Worker-internal. Merging to `main` triggers `.github/workflows/deploy-worker.yml` automatically. **No manual GPT Builder update is required for this plan** — no task touches `actions/` or `gpt/`.

Lane B adds response fields that are not yet in the OpenAPI. That is intentional and safe: additive response fields do not break a Custom GPT, and it keeps `actions/` under Phase 2's sole ownership. Until Phase 2 lands, the GPT ignores the new fields and lowest-BIN behaves exactly as it does today, only faster.

After deployment, check `/health` and one narrow authenticated route without exposing the header in logs.

## Follow-up: Phase 2 (separate plan)

Not in this plan. Needs its own, written after Phase 1 merges:

- Wire `levels.js` into slayers, dungeons, pets
- `compactPets` totals and truncation (breaking array-to-object shape change)
- New sections: `crimson`, `jacobs`, `trophy_fish`, `progression`
- OpenAPI: section enum, response schemas, Lane B's field delta
- `gpt/instructions.md`, `gpt/knowledge/market-playbook.md` (lowest-BIN merge loop, 5xx back-off), `docs/PROJECT_CONTEXT.md`
- Both Worker version strings
- Manual GPT Builder sync
