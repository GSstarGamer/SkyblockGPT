# Custom GPT configuration

## Name

SkyBlockGPT

## Description

An unofficial Hypixel SkyBlock assistant that checks live profiles, HotM/HotF, skills, gear, accessories, inventories, NBT, Bazaar, auctions, and market history—then does the math and gives sourced progression advice. Made by GS

## Conversation starters

1. Ask me which item I want, then walk the auction house to a genuinely authoritative lowest BIN: loop every segment from `next_start_page`, carry the same `expected_last_updated`, keep the running minimum, and restart at page 0 if a 409 says the snapshot moved. Report `segments_required`, `decodes_performed`, and whether `authoritative_lowest_bin` is real or still null. Then price the Bazaar craft against it and compute median, 10% trimmed mean, and outlier bounds over recent sales.
2. Ask for my IGN and profile, then derive every level Hypixel only ships as raw XP: all six slayers—vampire caps at 5 while the rest cap at 9—plus Catacombs and each dungeon class. For each, show experience, derived level, XP to next, percent progress, `table_version`, and the ladder's exact `source_url`. Flag any ladder whose `source_authority` is not the pinned wiki, then rank which grind buys the most levels per million XP.
3. Ask for my IGN, then pull my pets and treat the payload as an object, not a list. Reconcile `total_pets` against `returned` and tell me precisely what truncated and why before drawing any conclusion. Derive each pet's level from its own rarity ladder, keeping any Golden Dragon on its own curve rather than the shared legendary one. Rank my ten most valuable pets by XP remaining to max and total Bazaar cost to finish.
4. Ask for my IGN, then pull my bestiary and rift sections and check `payload_truncated` on each before concluding anything. Compute kills-to-next-tier for the ten mobs I am closest on—verify every tier threshold on the exact official wiki page, since no bestiary ladder ships with the gateway—then rank them by kills required per remaining tier and tell me which is actually worth my time.

## Capabilities

- Web Search: on, for the official Hypixel SkyBlock Wiki and correctly matched images.
- Code Interpreter & Data Analysis: on, for optimization, statistics, and charts.
- Image Generation: optional; never substitute generated art for factual wiki images.

## Actions

1. `actions/minecraft-username.openapi.json`
   - Authentication: None
   - Privacy policy: `https://privacy.microsoft.com/en-us/privacystatement`
2. `actions/hypixel-worker.openapi.json`
   - Authentication: API key
   - Header: `X-GPT-Key`
   - Value: the same private value stored as the Worker's `GPT_SHARED_SECRET`
   - Privacy policy: `https://skyblock-gpt-proxy.girishsonic8.workers.dev/privacy`
3. `actions/skycofl.openapi.json`
   - Authentication: API key using Bearer authentication
   - Value: the raw SkyCofl account token, without `Bearer` or quotes
   - Privacy policy: `https://coflnet.com/privacy`

## Knowledge

Upload every file in `gpt/knowledge/` to the GPT's Knowledge section:

- `api-playbook.md`
- `calculations.md`
- `market-playbook.md`

The instructions name these files and tell the GPT to open the matching one before acting. Renaming a file without updating the instructions breaks retrieval; `npm test` fails if the two disagree.

Conversations can reveal Knowledge file contents to users. These files hold only public behavior rules, and no credential may ever be placed in them.

## Sync steps

Paste `gpt/instructions.md` into the GPT's Instructions field, and replace any changed Knowledge upload with its current copy. A stale Knowledge file produces no error—the GPT just follows outdated procedure. Never put credentials in this repository.

