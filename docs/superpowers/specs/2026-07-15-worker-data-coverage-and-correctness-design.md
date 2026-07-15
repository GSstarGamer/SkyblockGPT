# Worker data coverage and correctness

**Date:** 2026-07-15
**Status:** Approved, pending implementation plan

## Problem

An audit of `src/` against the Hypixel SkyBlock API found two distinct classes of gap.

**Endpoint coverage is complete.** All sixteen SkyBlock endpoints are wired: `profiles`, `museum`, `garden`, `bingo`, `bazaar`, `auctions`, `auctions_ended`, `auction`, `news`, `firesales`, and all five `resources/skyblock/*`. Nothing is missing at this layer, and nothing in this spec changes it.

**Member-payload coverage is roughly half.** The Worker downloads the whole profile blob and then discards most of it. Several confirmed bugs also make shipped data wrong or useless.

## Findings

### Confirmed bugs

| # | Finding | Evidence |
|---|---|---|
| 1 | `/v1/auctions/lowest-bin` can never report an authoritative result | `src/routes/market.js:178` caps `max_pages` at 4; `:273` requires `endPageExclusive >= totalPages`. Live AH is ~60-90 pages, so `4 >= 90` is false and `complete` is permanently false. `scripts/test-worker.mjs:124` mocks `totalPages: 2`, making `:186` assert `complete: true`. The fixture is what hides the bug. |
| 2 | `filterNumericStats` matches almost nothing | `src/sections.js:822`. `player_stats` is nested (`kills: {...}`, `deaths: {...}`). Key `kills` matches `/kill/` but its value is an object, so the `typeof` guard drops it. Per-category `lifetime_counters` return near-empty while the section-level full dump duplicates everything anyway. No `player_stats` fixture exists. |
| 3 | Museum ships raw truncated base64 | `src/sections.js:69`. Item NBT blobs are never decoded; `sanitize` truncates each base64 string at 2000 chars. Pure token waste, and no reforge/stars are visible. |
| 4 | Player data is cached against the repo's own rule | `src/routes/player.js:288`, `:313`, `:326` cache player museum/garden/bingo for 60s. `AGENTS.md:59` states player profiles are intentionally uncached and player profile/inventory responses must not be persisted. `/privacy` makes the same public promise. |
| 5 | `persistentCache` branch is dead **and** a footgun | `src/hypixel.js:32-43,73-80` reads and writes `caches.default`, but `fetchHypixelJson` never passes `persistentCache`, so it is unreachable. If it were ever wired, it would persist player profiles to Cloudflare's edge cache — exactly what `AGENTS.md:59` and `/privacy` forbid. |
| 6 | Silent truncation with no signal | `sanitize` (`src/util.js:68`) returns `"[omitted]"` past depth and slices arrays at 250 with no flag. `compactPets` (`src/sections.js:883`) slices at 250 with no total. `AGENTS.md:61` requires explicit completeness indicators. |
| 7 | Dead code | `mapInBatches` (`src/util.js:1`) is declared, never used, never exported. |
| 8 | Fake batching | `src/routes/market.js:231-240` slices one page per iteration, so the `Promise.all` is decorative and fetches are sequential. |
| 9 | `backpack_icons` misclassified as backpacks | `src/items.js:123`. Icon blobs match `/backpack/` and appear as fake containers in the inventory index. |

### Dropped member data

No route or section reaches these, though the Worker already has them in hand:

`jacobs_contest`, `nether_island_player_data` (Kuudra, dojo, faction reputation, abiphone, matriarch), `trophy_fish`, `experimentation`, `events.easter`, `player_data.crafted_generators` (minion slots), `player_data.perks` / `active_effects` / `temp_stat_buffs` / `visited_zones` / `death_count`, `leveling.*` beyond `experience`, `quests`, `objectives`, `garden_player_data`, `pets_data.autopet` / `pet_care`, `profile.personal_bank_upgrade`, `cookie_buff_active`, `banking.transactions`, `community_upgrades`, `dungeons.dungeon_journal` / `treasures` / `daily_runs`, `item_data`, and all coop members other than the requester.

`compactStats` returns `current_effective_stats.available: false` citing "gear, pets, perks, accessories" as required inputs — while `perks` and `active_effects` are precisely what the Worker never exposes.

### XP without levels

Only skills get level derivation (`calculateSkillProgress`, `src/sections.js:403`), sourced from Hypixel's authoritative `skills` resource. Slayer, catacombs, dungeon classes, pets, and bestiary ship raw XP. Hypixel publishes no ladder for any of them.

`scripts/test-worker.mjs` never mocks `resources/skyblock/skills`, so `fetchSkillResource` returns null and `calculateSkillProgress` never executes under test.

### Retracted

An earlier draft called `fetchProfiles` `cacheSeconds: 0` a performance bug and proposed a 30-60s profile cache. That is wrong. `AGENTS.md:59` makes uncached profiles a deliberate privacy rule, and `/privacy` publicly commits to it. The current behavior is correct. This spec moves in the opposite direction: less caching, not more.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Slicing | Prep phase, then 4 parallel lanes, then sequential contract phase | Findings share files; `src/sections.js` alone is touched by 5 of them |
| Lowest-BIN | Honest contract + client-side merge | No new infra, works on any Cloudflare plan. Costs ~20 Action calls per full scan |
| Level tables | Worker `src/levels.js` with provenance fields | Testable, versioned, auto-deploys, no GPT sync. A stale `gpt/knowledge/` file fails silently (`AGENTS.md:113`) |
| Cache floor | Player 0, market 0, static 6h; delete `persistentCache` | Values change fast; only genuinely static ID/threshold tables stay cached |

## Concurrency safety model

Agents may run concurrently **only when they own disjoint files.** Finding-level parallelism is unsafe here; file-level ownership is the real constraint.

Three concerns are cross-cutting and therefore cannot be lane work:

- **`scripts/test-worker.mjs`** — a single 202-line linear script every lane must append to. Guaranteed conflict.
- **Cache TTLs** — scattered across four route files as `cacheSeconds` arguments. That scattering is why finding #4 drifted unnoticed.
- **`sanitize()`** — consumed by every module. One lane changing its shape while another consumes it is a semantic conflict even with zero file overlap.

All three are resolved in Phase 0 before any fan-out.

## Phase 0 — prep (solo, blocking)

### Test harness split

`scripts/test-worker.mjs` becomes:

- `scripts/tests/_fixtures.mjs` — shared mock upstream and fixtures
- `scripts/tests/*.test.mjs` — one file per module under test
- `scripts/test-worker.mjs` — runner importing all test files

`npm test` and the `test:worker` script keep their current behavior and entry point.

### Fixture gaps

Add mocks for museum, garden, bingo, `auctions_ended`, `auction`, `resources/skyblock/skills`, news, firesales, and election. The current mock throws `Unexpected upstream URL` for all of them, leaving those routes untested.

Add a nested `player_stats` fixture matching the real shape (`{ kills: {...}, deaths: {...}, highest_critical_damage: N }`). Its absence is why finding #2 survived.

Fix the misleading AH fixture: keep the `totalPages: 2` case, and add a realistic `totalPages: 90` case asserting `complete: false`. Both cases must exist — the small one proves completeness works when reachable, the large one pins the production reality.

### Cache policy centralization

Introduce a `CACHE_POLICY` map in `src/hypixel.js` keyed by upstream path. Call sites stop passing `cacheSeconds`. Delete the `persistentCache` branch and its `Request` / `caches.default` code entirely.

| Upstream | TTL | Reason |
|---|---:|---|
| `/v2/skyblock/profiles` | 0 | player data (`AGENTS.md:59`) |
| `/v2/skyblock/auctions` | 0 | changes fast |
| `/v2/skyblock/museum`, `/garden`, `/bingo` | 0 | player data — **changed from 60s** |
| `/v2/skyblock/bazaar` | 0 | changes fast — **changed from 15s** |
| `/v2/skyblock/auctions_ended`, `/auction` | 0 | changes fast — **changed from 20s** |
| `/v2/resources/skyblock/election`, `/v2/skyblock/firesales` | 60 | slow-moving |
| `/v2/skyblock/news`, `/v2/resources/skyblock/bingo` | 300 | slow-moving |
| `/v2/resources/skyblock/items`, `/skills`, `/collections` | 21600 | static ID/threshold tables |

Unknown paths default to 0. Caching must be opt-in, never inherited.

### Pinned `sanitize()` contract

Signature gains an optional fourth parameter, a mutable report collector. Omitting it preserves today's exact behavior, so the change is backward compatible.

```js
sanitize(value, depth = 5, maxEntries = 300, report = null)
// report, when supplied: { truncated: boolean, reasons: string[] }
// Mutated in place when a depth cutoff, array slice, object slice,
// or string clamp actually drops data.
```

Callers that need completeness signals pass a collector and surface `truncated` in their payload. Lane C implements it.

The contract is pinned here rather than left to Lane C because `sanitize` is consumed by every module: a lane discovering mid-flight that it needs truncation reporting must not be able to reshape a shared function other lanes are concurrently building against. Pinning the signature up front makes the dependency inert regardless of which lanes end up using the collector.

## Phase 1 — four lanes

Disjoint file ownership. No lane touches `actions/` or `gpt/`.

### Lane B — `src/routes/market.js`, `src/market.js`

Lowest-BIN honest contract. Keep the 4-page cap; stop pretending.

```
scan: {
  snapshot_last_updated,
  segments_required,     // NEW: ceil(totalPages / max_pages)
  segment_index,         // NEW: floor(start_page / max_pages)
  next_start_page,       // existing, null when done
  complete               // true only when this segment covers all pages
}
segment_lowest_bin       // existing
```

The GPT loops on `next_start_page`, carrying `expected_last_updated`, keeping a running minimum, and may declare a genuine global lowest BIN once `next_start_page` is null and the snapshot held. Non-negotiable product rule 6 in `AGENTS.md` stays satisfied: no page-local minimum is ever called global, and `authoritative_lowest_bin` stays null on every individual segment.

Also remove the fake one-page batching at `:231-240` and fetch remaining pages in a real parallel batch.

New response fields ship **before** they appear in the OpenAPI. Additive response fields do not break a Custom GPT, and this keeps `actions/` single-owner. Phase 2 documents them and teaches the GPT to loop; until then behavior is unchanged.

### Lane C — `src/util.js`, `src/items.js`

- Delete `mapInBatches`.
- Implement the pinned `sanitize` report collector.
- Fix `backpack_icons` misclassification in `inventoryContainerKind` / `findNbtContainers`; icons must not appear as containers.
- Surface truncation on `attributes` (capped at 20) and `enchantments` (capped at 50) in `compactNbtItem`.

### Lane D — `src/sections.js`

- Fix `filterNumericStats` to walk nested `player_stats` and emit dotted keys (`kills.total`), keeping the existing per-category regexes. Purely additive: fields that were empty gain values.
- Museum **decode-after-paginate**: paginate first (limit ≤40), then decode only that page's blobs into compact item records, and drop the raw base64 from the payload. Keeps CPU bounded while removing the token waste.

`compactPets` is explicitly **out of scope for this lane** — see Phase 2.

### Lane E — `src/levels.js` (new)

Greenfield, zero conflict surface. Pure module, no consumers until Phase 2.

Ladders for slayer bosses, catacombs, dungeon classes, and pet rarities. Bestiary is excluded: hundreds of per-mob ladders, low payoff.

Every derived level carries provenance, so the Worker never silently asserts a fact no API gave it:

```js
{
  experience: 1043000,
  level: 9,
  level_source: "static_table",
  table_version: "2026-07-15",
  verify_on_wiki: true
}
```

This is the one place the Worker holds non-API facts. Provenance fields are the mitigation and are non-negotiable.

## Phase 2 — contract change (sequential, one agent)

Runs after Phase 1 merges. Owns **all** of `actions/` and `gpt/` so nothing else touches the contract.

- Wire `levels.js` into slayers, dungeons, and pets.
- `compactPets`: add level derivation, plus `total_pets` / `truncated` honesty. This changes the section payload from a bare array to an object — a breaking shape change, which is why it lives here alongside the OpenAPI and GPT updates rather than in Lane D.
- New sections: `crimson`, `jacobs`, `trophy_fish`, `progression` (minions, perks, active effects, deaths).
- OpenAPI: section enum, response schemas, and Lane B's response-field delta.
- `gpt/instructions.md` (8000-char limit), `gpt/knowledge/*.md` (including the lowest-BIN merge loop in `market-playbook.md`), `docs/PROJECT_CONTEXT.md` endpoint table.
- Both Worker version strings (`UPSTREAM_USER_AGENT` and `/health`). Phase 2 owns all version bumps to avoid lane conflicts.

## Verification

Every lane runs before reporting:

```bash
npm test
npm run deploy:dry
```

Phase 1 is Worker-internal: auto-deploys on merge to `main`, no GPT Builder sync. Phase 2 is the only manual sync — replace the schema in the existing Worker Action set, re-upload every changed `gpt/knowledge/` file, then **Update**.

## Prerequisite

The working tree is dirty: `AGENTS.md`, `docs/CHANGE_PLAYBOOK.md`, `gpt/config.md`, `gpt/instructions.md`, and `scripts/validate.mjs` are modified, and `gpt/knowledge/` is untracked. Phase 2 edits `gpt/instructions.md` and `gpt/knowledge/`. That pending work is one coherent unit — knowledge files plus the validator enforcing their pointers — and must land as its own commit before agents start.

## Out of scope

- `/v2/player` and `/v2/guild` (SkyBlock achievement tiers, guild data) — explicitly deprioritized.
- Bestiary level derivation.
- Coop member data beyond the requester.
- `banking.transactions`.
- Any KV, Durable Object, or cron infrastructure. The lowest-BIN decision avoids all three.
- Profile caching in any form.
