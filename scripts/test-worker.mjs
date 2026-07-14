import assert from "node:assert/strict";
import worker from "../src/worker.js";

const playerUuid = "0123456789abcdef0123456789abcdef";
const itemNbt = "H4sIAAAAAAAAAB2NQQqCQBhGv1ErHaKu0KoLtGtnarRIhTpA/OGfDIwZ4wxUF/IeHiyyto/3eBKIIJQEIDx4qsJaYJK07m6FhG+p9hEdVMV7TXU3Wh+JWaW6h6ZXhODYGg5/LeZDfxt6nZR5XhYhgoIaxmKE8dsZXu20YwuJZfa0hmJrjbo6y134f8pTll5O5TnbbgAP05Qaqhk+8AVIrd2eoAAAAA==";

const auction = (uuid, price, bin = true) => ({
  uuid,
  auctioneer: playerUuid,
  profile_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  start: 1,
  end: 9_999_999_999_999,
  item_name: "Azure Bluet",
  extra: "Azure Bluet Red Rose",
  category: "blocks",
  tier: "COMMON",
  starting_bid: price,
  highest_bid_amount: bin ? price : 0,
  bin,
  bids: [],
  item_bytes: { type: 0, data: itemNbt },
});

globalThis.fetch = async (input) => {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);

  if (url.pathname === "/v2/skyblock/profiles") {
    return Response.json({
      success: true,
      profiles: [{
        profile_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        cute_name: "Mango",
        selected: true,
        members: {
          [playerUuid]: {
            last_save: 100,
            collection: { COBBLESTONE: 750, DIAMOND: 25 },
            accessory_bag_storage: { selected_power: "fortuitous", highest_magical_power: 465 },
            forge: {
              forge_processes: {
                forge_1: {
                  0: { id: "REFINED_MITHRIL", type: "REFINING", startTime: 1_700_000_000_000, duration_ms: 21_600_000 },
                  1: { id: "REFINED_TITANIUM", type: "REFINING", startTime: 1_700_000_000_000 },
                  2: { id: "PET", type: "CASTING", startTime: 1_700_000_000_000, endTime: 1_700_000_001_000 },
                },
              },
            },
            inventory: {
              talisman_bag: { type: 0, data: itemNbt },
              sacks_counts: { ENCHANTED_TITANIUM: 16, AZURE_BLUET: 0 },
            },
          },
        },
      }],
    });
  }

  if (url.pathname === "/v2/resources/skyblock/collections") {
    return Response.json({
      success: true,
      lastUpdated: 123,
      version: "test",
      collections: {
        MINING: {
          name: "Mining",
          items: {
            COBBLESTONE: {
              name: "Cobblestone",
              maxTiers: 3,
              tiers: [
                { tier: 1, amountRequired: 50, unlocks: ["Cobblestone Minion Recipe"] },
                { tier: 2, amountRequired: 100, unlocks: ["Compactor Recipe"] },
                { tier: 3, amountRequired: 1000, unlocks: ["Haste Ring Recipe"] },
              ],
            },
          },
        },
      },
    });
  }

  if (url.pathname === "/v2/resources/skyblock/items") {
    return Response.json({
      success: true,
      lastUpdated: 123,
      items: [
        { id: "RED_ROSE:3", name: "Azure Bluet" },
        { id: "ENCHANTED_TITANIUM", name: "Enchanted Titanium" },
        { id: "BOOSTER_COOKIE", name: "Booster Cookie" },
      ],
    });
  }

  if (url.pathname === "/v2/skyblock/bazaar") {
    return Response.json({
      success: true,
      lastUpdated: 456,
      products: {
        BOOSTER_COOKIE: {
          product_id: "BOOSTER_COOKIE",
          sell_summary: [{ amount: 4, pricePerUnit: 100, orders: 1 }],
          buy_summary: [{ amount: 5, pricePerUnit: 90, orders: 2 }],
          quick_status: {
            productId: "BOOSTER_COOKIE",
            sellPrice: 100,
            sellVolume: 10,
            sellMovingWeek: 70,
            sellOrders: 3,
            buyPrice: 90,
            buyVolume: 20,
            buyMovingWeek: 140,
            buyOrders: 4,
          },
        },
      },
    });
  }

  if (url.pathname === "/v2/skyblock/auctions") {
    const page = Number(url.searchParams.get("page") || 0);
    return Response.json({
      success: true,
      page,
      totalPages: 2,
      totalAuctions: 4,
      lastUpdated: 456,
      auctions: page === 0
        ? [auction("a", 100), auction("b", 75), auction("c", 1, false)]
        : [auction("d", 50)],
    });
  }

  throw new Error(`Unexpected upstream URL: ${url}`);
};

const env = { HYPIXEL_API_KEY: "hypixel-test", GPT_SHARED_SECRET: "shared-test" };
const call = async (path, authenticated = true) => worker.fetch(new Request(`https://worker.test${path}`, {
  headers: authenticated ? { "X-GPT-Key": "shared-test" } : {},
}), env);

const health = await (await call("/health", false)).json();
assert.equal(health.success, true);
assert.equal(health.version, "2.5.0");

const unauthorized = await call(`/v1/player/profiles?uuid=${playerUuid}`, false);
assert.equal(unauthorized.status, 401);

const collectionsResponse = await call(`/v1/player/collections?uuid=${playerUuid}&query=cobble&include_unlocks=true`);
const collections = await collectionsResponse.json();
assert.equal(collectionsResponse.status, 200, JSON.stringify(collections));
assert.equal(collections.payload_kind, "player_collections");
assert.equal(collections.data.collections[0].achieved_tier, 2);
assert.equal(collections.data.collections[0].next_tier, 3);
assert.deepEqual(collections.data.collections[0].unlocked_rewards, ["Cobblestone Minion Recipe", "Compactor Recipe"]);

const accessoriesResponse = await call(`/v1/player/accessories?uuid=${playerUuid}`);
const accessories = await accessoriesResponse.json();
assert.equal(accessoriesResponse.status, 200, JSON.stringify(accessories));
assert.equal(accessories.payload_kind, "player_accessories");
assert.equal(accessories.data.total_accessories, 1);
assert.equal(accessories.data.selected_power, "fortuitous");
assert.equal(accessories.data.highest_magical_power, 465);

const forgeResponse = await call(`/v1/player/section?uuid=${playerUuid}&section=forge`);
const forge = await forgeResponse.json();
assert.equal(forgeResponse.status, 200, JSON.stringify(forge));
assert.equal(forge.payload_kind, "profile_section_forge");
assert.equal(forge.data.processes.length, 3);
assert.equal(forge.data.processes.some((process) => process.needs_wiki_duration), true);

const sacksResponse = await call(`/v1/player/sacks?uuid=${playerUuid}&query=titanium`);
const sacks = await sacksResponse.json();
assert.equal(sacksResponse.status, 200, JSON.stringify(sacks));
assert.equal(sacks.data.items[0].item_id, "ENCHANTED_TITANIUM");
assert.equal(sacks.data.items[0].quantity, 16);

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

console.log(JSON.stringify({
  success: true,
  collection_tier: collections.data.collections[0].achieved_tier,
  accessories: accessories.data.total_accessories,
  forge_processes: forge.data.processes.length,
  sacks_quantity: sacks.data.items[0].quantity,
  bazaar_product: bazaarProduct.data.product_id,
  authoritative_lowest_bin: lowest.data.authoritative_lowest_bin.bin_price,
}));

