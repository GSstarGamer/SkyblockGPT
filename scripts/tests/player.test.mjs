import assert from "node:assert/strict";
import { call, installMockFetch, playerUuid } from "./_fixtures.mjs";

export async function run() {
  installMockFetch();

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
}
