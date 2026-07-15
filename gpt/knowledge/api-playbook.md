# API playbook

Which Worker operation to call per domain, and how to paginate. Follow this exactly. Never guess an operation name or parameter.

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
