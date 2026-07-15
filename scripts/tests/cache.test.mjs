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
