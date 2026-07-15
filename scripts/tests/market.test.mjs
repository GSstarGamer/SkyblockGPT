import assert from "node:assert/strict";
import { auction, call, installMockFetch, itemNbt, playerUuid, profileId } from "./_fixtures.mjs";

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

  // Exactly-at-budget regression: 60 BIN candidates that all pass the name
  // prefilter (searching for "Enchanted Titanium") but all decode to a
  // different item (the shared fixture blob is RED_ROSE:3), so none of them
  // ever becomes a match. decodesPerformed lands on exactly decodeBudget (60)
  // having drained every one of the 60 candidates — nothing was skipped, so
  // the scan was genuinely exhaustive and decode_budget_exhausted must be
  // false, not a false positive from landing on the budget number.
  installMockFetch({
    "/v2/skyblock/auctions": () => Response.json({
      success: true,
      page: 0,
      totalPages: 1,
      totalAuctions: 60,
      lastUpdated: 456,
      auctions: Array.from({ length: 60 }, (_, index) => ({
        uuid: `budget-${index}`,
        auctioneer: playerUuid,
        profile_id: profileId,
        start: 1,
        end: 9_999_999_999_999,
        item_name: "Enchanted Titanium",
        extra: "",
        category: "misc",
        tier: "COMMON",
        starting_bid: 100 + index,
        highest_bid_amount: 100 + index,
        bin: true,
        bids: [],
        item_bytes: { type: 0, data: itemNbt },
      })),
    }),
  });

  const atBudget = await (await call("/v1/auctions/lowest-bin?item=ENCHANTED_TITANIUM")).json();
  assert.equal(atBudget.data.scan.name_prefilter_candidates, 60, "all 60 auctions must pass the name prefilter");
  assert.equal(atBudget.data.scan.decodes_performed, 60, "every candidate must have been decoded");
  assert.equal(atBudget.data.scan.decode_failures, 0, "the shared fixture blob decodes cleanly, it just doesn't match");
  assert.equal(atBudget.data.match_count_in_segment, 0, "none of the 60 decode to ENCHANTED_TITANIUM");
  assert.equal(atBudget.data.scan.decode_budget_exhausted, false, "draining every candidate is not budget exhaustion");
}
