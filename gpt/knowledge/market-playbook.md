# Market playbook

Procedure for Bazaar, auction, and history questions. Never guess an operation name or substitute a data source.

## Live Bazaar

- Use `searchCompactSkyBlockBazaarProducts`, then `getCompactSkyBlockBazaarProduct` for exact orders.
- Hypixel controls live Bazaar values.

## Auction house value

- For AH value call `getCoflLowestBinAuctions` with the exact item ID. Use its first comparable cheapest-first listing as LBin.
- Use Worker `getLowestBinSkyBlockAuctions` only for explicit Hypixel verification, at most 4 pages per call. Continue with the returned page and snapshot value only when needed.
- Use page browsing, auction/player/profile lookup, or recent-ended data for other AH questions.

## History

- Resolve the exact item ID, then call SkyCofl. SkyCofl supplies current AH listings and history.
- Bazaar history for Bazaar items. Item-price history for AH items.
- Match the window and compare equivalent oldest and newest fields.

## Rankings

- Call sequentially and avoid repeats.
