# API playbook

Which Worker operation to call per domain, and how to paginate. Follow this exactly. Never guess an operation name or parameter.

## Truncated payloads

Several sections cap by size and flag it. Treat `true` as partial data, not the full record:

- Bestiary and Rift sections: `payload_truncated`.
- `stats`: `lifetime_counters_truncated` on the lifetime counters map.
- `garden`: `garden_truncated`.
- Museum items: each entry's `decoded_items_truncated` (a multi-item donation exceeded the per-entry cap).
- Any decoded item (gear, inventories, accessories, museum, auctions): `attributes_truncated` / `enchantments_truncated` when it carries more than the capped list.

## Slayer and dungeon levels

- `section=slayers` and `section=dungeons` return derived levels from static tables, not from any Hypixel resource — Hypixel publishes XP thresholds for skills only via its `skills` resource. Each item's `level` object (`available`, `level`, `level_with_progress`, `xp_into_level`, `xp_for_next_level`, `progress_to_next_level`) carries a `ladder` pointer into the section's single `level_provenance.ladders` map.
- Every ladder is `source_authority: wiki` and carries a `source_url` in `level_provenance.ladders[ladder]` — derived levels come from static tables, not a Hypixel endpoint. Verify against that `source_url` when a level is load-bearing (dungeon-class player levels are sourced from `wiki.hypixel.net`, since the pinned wiki publishes no class-leveling page; every other ladder is from the pinned wiki).
- `dungeons` splits `dungeon_types` (only Catacombs has a sourced ladder; other dungeon types report level unavailable) from `player_classes` (all five classes share the `dungeon_class` ladder).
- `level.available: false` means the level could not be derived (no XP exposed, or no matching ladder); never report it as level 0.

## Pets

- `section=pets` returns an object, not a list: `available`, `total_pets`, `returned`, `truncated`, `truncation_reason`, `level_provenance`, `pets`, `reason`. It is budgeted by response size, so a large collection truncates.
- `total_pets` is always the player's true pet count; `returned` is only how many pets came back this call. Never report `returned` as the total.
- When `truncated` is true, say the pet list is partial and name why (`truncation_reason`: `response_size_budget` or `pet_count_cap`).
- Pet levels use the same `level`/`level_provenance` shape as slayers and dungeons, keyed by rarity ladder (or `golden_dragon` for that pet).

## Reviews

- Mining review: call summary, `mining`, `stats`, `gear`, and the inventory index. `mining` carries HotM.
- Foraging review: call `foraging` for HotF perks, selected ability, tokens, Forest Whispers, and progression.
- Forge: call `forge`. If `needs_wiki_duration` is set, verify the exact duration on the item's wiki page and calculate the finish time from it.
- Worn gear: `gear`.
- Use `stats` for calculated skills and lifetime counters, not a live Stats-menu snapshot. Effective totals depend on gear, pets, perks, buffs, and location.
- A lone `received_free_tier` is incomplete.

## Accessories

- Accessory questions must use `getTypedSkyBlockAccessories` and paginate `data.accessories`.
- Never substitute the generic `accessories` section.

## Collections

- Collection and craftability audits use `getTypedSkyBlockPlayerCollections` with `include_unlocks=true`.
- Compare the achieved tier to the Collections resource and the exact item wiki. Count alone does not prove usability.

## Inventories and sacks

- For items, call the inventory index, then its paginated container. Request full item detail only for needed NBT or lore.
- Paginate only as needed.
- Sack quantities: `getCompactSkyBlockSacks`. Owning a Sack item does not reveal its contents. Missing `sacks_counts` is unavailable, not zero.
- Call Inventory API disabled only when no container was exposed. Decode errors are a different case.

## Official resources

- `getCompactSkyBlockResource` for official Items, Collections, Skills, Election, or current Bingo data. Search first; request full detail only for exact matches.
- `getCompactSkyBlockPlayerExtra` for Museum, Garden, or a player's Bingo history. Museum results are paginated.
