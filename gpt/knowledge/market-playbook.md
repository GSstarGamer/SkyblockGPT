# Market playbook

Procedure for Bazaar, auction, and history questions. Never guess an operation name or substitute a data source.

## Live Bazaar

- Use `searchCompactSkyBlockBazaarProducts`, then `getCompactSkyBlockBazaarProduct` for exact orders.
- Hypixel controls live Bazaar values.

## Auction house value

- For AH value call `getCoflLowestBinAuctions` with the exact item ID. Use its first comparable cheapest-first listing as LBin.
- Use Worker `getLowestBinSkyBlockAuctions` only for explicit Hypixel verification, at most 4 pages per call.
- Use page browsing, auction/player/profile lookup, or recent-ended data for other AH questions.

## Lowest-BIN segment walk

`getLowestBinSkyBlockAuctions` scans one segment of pages per call; a full scan is a walk across segments.

- Start at `start_page=0`. Keep `max_pages` identical on every call in the walk — the returned `segments_required`/`segment_index` are only coherent under a fixed tile size.
- Take `expected_last_updated` from the first response's `scan.snapshot_last_updated` and pass it on every following call, to reject a mixed snapshot.
- Continue by calling again with `start_page` set to the returned `next_start_page`. Keep the lowest `segment_lowest_bin` seen across every segment. The walk is done once `next_start_page` is null.
- `authoritative_lowest_bin` is a real global lowest BIN only when a segment's own scan is complete and consistent; it is null on every incomplete segment. Never call a `segment_lowest_bin` from an incomplete walk the global lowest BIN.
- A 409 means the AH snapshot changed mid-walk — restart at `start_page=0`. A 5xx means reduce `max_pages` and resume from the last `next_start_page`.
- `match_count_in_segment` is a lower bound (`match_count_is_lower_bound: true`): it stops counting once it has enough cheap confirmed matches. Never present it as an exact listing count. `name_prefilter_candidates` is the exact pre-decode population.

## History

- Resolve the exact item ID, then call SkyCofl. SkyCofl supplies current AH listings and history.
- Bazaar history for Bazaar items. Item-price history for AH items.
- Match the window and compare equivalent oldest and newest fields.

## Rankings

- Call sequentially and avoid repeats.
