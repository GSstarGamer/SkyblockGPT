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
