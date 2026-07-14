# SkyBlockGPT project context

## Product summary

SkyBlockGPT is an unofficial public Custom GPT for Hypixel SkyBlock. It combines live/player-specific API data with official wiki verification and then performs progression, inventory, crafting, Forge, Bazaar, auction, and statistical analysis.

Public GPT: `https://chatgpt.com/g/g-6a551449ab448191889f07e54162659f-skyblockgpt`

Creator contact: Discord `gs._`

The intended voice is a slightly tired SkyBlock player who sounds nonchalant but is actually careful and helpful. Answers should be direct, concise, sourced, and willing to say that data is unavailable. The GPT is public: each chat supplies an IGN, and the system must never assume the creator's identity.

## System architecture

```text
Public user
   |
   v
SkyBlockGPT in ChatGPT
   |-- Minecraft Services Action --> username -> UUID
   |-- Unified Worker Action ------> Cloudflare Worker
   |                                   |-- Hypixel player/profile APIs
   |                                   |-- Hypixel resources/Bazaar/AH APIs
   |                                   `-- NBT decode, filtering, pagination
   |-- Direct SkyCofl Action ------> history, sold auctions, AH comparables
   `-- Web search -----------------> official Hypixel SkyBlock Wiki + images
```

The Worker exists because raw Hypixel profiles, Bazaar payloads, and auction pages are too large and inconsistent for reliable Custom GPT Actions. It selects a profile, decodes NBT, normalizes fields, filters records, and paginates data before ChatGPT sees it.

## Trust and data-source boundaries

| Question | Authoritative source | Notes |
|---|---|---|
| IGN to UUID | Minecraft Services Action | Resolve per requested player; reuse only in the current chat. |
| Player/profile state | Hypixel through Worker | API-enabled/missing fields remain unavailable, never zero. |
| Current Bazaar | Hypixel through Worker | Distinguish instant buy/sell from order/offer prices and include timestamp. |
| Current Hypixel auctions | Hypixel through Worker | Page scans can be partial; lowest-BIN completeness must be explicit. |
| AH history/sold/comparables | Direct SkyCofl Action | Authentication lives in ChatGPT, never the Worker/repository. |
| Item facts/mechanics/recipes | Official Hypixel SkyBlock Wiki | Verify the exact current page for every item-specific answer. |
| Player item modifiers | Decoded Hypixel NBT | Reforges, stars, enchants, attributes, gemstones, and lore are instance data. |
| Images | Exact wiki/search result | Prefer 1-3 matched images for nontrivial content; never fabricate URLs. |

Do not use forums, SkyCrypt, or remembered facts as a substitute for an available authoritative source. If the sources conflict, report the conflict and identify which source controls which kind of fact.

## Worker surface

Public routes:

| Route | Purpose |
|---|---|
| `GET /health` | Service/version check; no authentication. |
| `GET /privacy` | Public privacy policy required by the GPT Action. |

Every route below requires `X-GPT-Key` and is defined in `actions/hypixel-worker.openapi.json`:

| Route | Operation ID | Purpose |
|---|---|---|
| `/v1/player/profiles` | `getCompactSkyBlockProfiles` | List compact profiles/cute names and membership. |
| `/v1/player/summary` | `getCompactSkyBlockProfileSummary` | Selected/requested profile overview, currencies, calculated skills. |
| `/v1/player/section` | `getCompactSkyBlockProfileSection` | One bounded section such as mining, forge, foraging, stats, gear, or pets. |
| `/v1/player/collections` | `getTypedSkyBlockPlayerCollections` | Typed, pageable collection progress and optional unlocked rewards. |
| `/v1/player/accessories` | `getTypedSkyBlockAccessories` | Typed accessory-bag contents, MP, selected power, pagination. |
| `/v1/player/inventories` | `getCompactSkyBlockInventoryIndex` | Available NBT container index; use before reading a container. |
| `/v1/player/inventory` | `getCompactSkyBlockInventoryContainer` | Page through one decoded container. |
| `/v1/player/item` | `getCompactSkyBlockInventoryItem` | Expanded detail for a selected item only. |
| `/v1/player/sacks` | `getCompactSkyBlockSacks` | Quantities from `sacks_counts`; owning a Sack item is not a quantity. |
| `/v1/player/extra` | `getCompactSkyBlockPlayerExtra` | Museum, Garden, and Bingo auxiliary data. |
| `/v1/resources` | `getCompactSkyBlockResource` | Search official Items, Collections, Skills, Election, or Bingo resources. |
| `/v1/feed` | `getCompactSkyBlockFeed` | News and Fire Sales feeds. |
| `/v1/bazaar/products` | `searchCompactSkyBlockBazaarProducts` | Search/filter/sort the Bazaar product index. |
| `/v1/bazaar/product` | `getCompactSkyBlockBazaarProduct` | Exact current product order summaries and quick status. |
| `/v1/auctions/page` | `browseCompactSkyBlockAuctionPage` | Filter/sort one upstream auction page. |
| `/v1/auctions/lowest-bin` | `getLowestBinSkyBlockAuctions` | Exact item-ID BIN scan with scan completeness and ascending comparables. |
| `/v1/auctions/lookup` | `lookupCompactSkyBlockAuctions` | Auction/player/profile lookup. |
| `/v1/auctions/ended` | `getCompactSkyBlockEndedAuctions` | Recent ended-auction data. |

The separate Action schemas intentionally use different domains:

- `api.minecraftservices.com`: one username lookup operation, no auth.
- `sky.coflnet.com`: Bazaar/AH history and auction evidence, Bearer auth stored in ChatGPT.
- `skyblock-gpt-proxy.girishsonic8.workers.dev`: all compact Hypixel operations, custom `X-GPT-Key` auth.

ChatGPT allows no more than 30 operations per Action set and rejects duplicate Action-set domains. Keep all Worker operations in its single unified schema.

## Response semantics

- `success: true` means the route completed, not that every optional field was present.
- `payload_kind` lets GPT instructions distinguish typed sections from generic/placeholder-looking data.
- `data_present: false` means unavailable or not exposed. Do not reinterpret it as zero.
- Empty typed arrays can be valid real results.
- Pagination fields and `has_more` must remain accurate.
- A page-local minimum is not a global minimum. Use explicit scan metadata.
- `needs_wiki_duration` on a Forge process means Hypixel omitted enough timing data; the GPT must verify the recipe duration on the exact wiki page before calculating.
- Effective Strength/Fortune and similar live totals can depend on held item, location, pets, armor, perks, buffs, and server state. Profile stats are evidence, not always a live Stats-menu total.
- Personal and co-op bank components have independent API availability. Preserve balance scope instead of calling a partial amount the total.

## Profile and inventory behavior

When no profile selector is supplied, the Worker selects Hypixel's selected profile and otherwise the most recently saved suitable profile. A selector may be a cute name or profile ID. The GPT should not demand a profile ID when an IGN is sufficient.

Inventory access is deliberately two-stage:

1. Request the inventory index.
2. Follow only relevant containers with pagination.
3. Request expanded item detail only when NBT/lore/modifiers are required.

This avoids connector resource limits. Never replace it with a route that dumps the full profile or every decoded item in one response.

## Market behavior

Hypixel is the live source for Bazaar and the verification source for active auctions. SkyCofl is the historical/comparable source. Do not silently mix:

- Bazaar instant-buy versus instant-sell.
- Bazaar buy-order versus sell-offer series.
- AH average versus median versus lowest BIN.
- Different history windows.
- Items with incompatible NBT/modifiers.
- Bazaar products and AH-only items.

Money-making and purchase recommendations must state timestamp, source, assumptions, fees when known, liquidity evidence, and whether the scan is complete.

## Product behavior stored outside code

`gpt/instructions.md` is production configuration, not ordinary documentation. It must remain below 8,000 characters and tells the model how to call Actions, interpret availability, verify wiki facts, use images, calculate values, and speak.

`gpt/config.md` contains the public listing and authentication map. Durable requirements include:

- Description ends with `Made by GS`.
- Creator contact is Discord `gs._`.
- Code Interpreter & Data Analysis remains enabled for optimization, statistics, and charts.
- Web Search remains enabled for exact wiki pages and matched images.
- Conversation starters should be niche, specific, and math-heavy enough to stress the Actions.

## Versioning

Two versions currently exist for different purposes:

- `package.json` version: repository/release ZIP version.
- Worker `UPSTREAM_USER_AGENT` and `/health` version: deployed gateway/API behavior version.

When the Worker contract or meaningful behavior changes, update the Worker version strings together. When cutting a repository release, update `package.json` and tag `v<version>`. Do not assume the two version numbers are interchangeable.

## Automation and manual boundaries

Automated:

- OpenAPI/ChatGPT-limit validation.
- Mocked Worker integration tests.
- Wrangler dry-run in CI.
- Worker deployment from relevant changes on `main`.
- Clean ZIP creation on `v*` tags.

Manual:

- Pasting changed `gpt/instructions.md` into the GPT Builder.
- Replacing a changed Action schema in its existing Action set.
- Rechecking Action authentication and Preview behavior.
- Clicking **Update** in the GPT Builder.

OpenAI does not provide a supported public Custom GPT configuration API used by this project. Do not add Playwright/session-cookie automation for the builder.

## Known failure modes

- `ResponseTooLargeError`/resource-limit: endpoint returned too much; add filtering/pagination or narrow the request.
- Action unavailable in a chat: platform/plan/model availability, not automatically a Worker bug and not a mobile-only issue.
- Duplicate Action domain: a second Action set uses the Worker domain; update the existing set instead.
- Missing HotM/HotF/bank/sacks: inspect actual returned paths and availability flags before blaming user API settings.
- `ClientResponseError`: surface the normalized upstream/connector error and test the narrow endpoint; do not fabricate fallback data.
- `429`: stop repeated calls and respect upstream rate limits.
- SkyCofl blocked from Worker: keep SkyCofl direct; do not proxy it through Cloudflare merely to evade provider controls.

## Definition of done

The implementation, OpenAPI contract, tests, GPT instructions/config, and these docs must describe the same behavior. Verification must pass, secrets must stay out of Git, responses must stay bounded, live/partial/unknown values must be labeled correctly, and the owner must receive any required manual GPT sync steps.
