import assert from "node:assert/strict";
import { call, installMockFetch, playerUuid } from "./_fixtures.mjs";

export async function run() {
  // player_stats is nested. The old filter tested the key `kills` against
  // /kill/, then dropped it because its value is an object.
  installMockFetch({
    "/v2/skyblock/profiles": () => Response.json({
      success: true,
      profiles: [{
        profile_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        cute_name: "Mango",
        selected: true,
        members: {
          [playerUuid]: {
            last_save: 100,
            player_stats: {
              kills: { total: 5_000, zombie: 1_200 },
              deaths: { total: 40 },
              highest_critical_damage: 1_000_000,
              mining: { ores_mined: 900 },
              auctions: { created: 3 },
            },
          },
        },
      }],
    }),
  });

  const response = await call(`/v1/player/section?uuid=${playerUuid}&section=stats`);
  const stats = await response.json();
  assert.equal(response.status, 200, JSON.stringify(stats));

  const combat = stats.data.combat.lifetime_counters;
  assert.equal(combat["kills.total"], 5_000, "nested kill counters must be reached");
  assert.equal(combat["kills.zombie"], 1_200);
  assert.equal(combat["deaths.total"], 40);
  assert.equal(combat.highest_critical_damage, 1_000_000, "scalars must still work");

  const mining = stats.data.mining.lifetime_counters;
  assert.equal(mining["mining.ores_mined"], 900);
  assert.equal(mining["kills.total"], undefined, "category regexes must still scope");

  // Museum decodes the paginated page and never ships raw base64.
  installMockFetch();
  const museumResponse = await call(`/v1/player/extra?uuid=${playerUuid}&kind=museum`);
  const museum = await museumResponse.json();
  assert.equal(museumResponse.status, 200, JSON.stringify(museum));

  // The museum key is the donated item's ID; the blob is its NBT. The shared
  // fixture blob decodes to RED_ROSE:3 ("Azure Bluet") — verified, not assumed.
  const entry = museum.data.items[0];
  assert.equal(entry.item_id, "ZOMBIE_SWORD", "museum key is preserved");
  assert.equal(entry.item.skyblock_id, "RED_ROSE:3", "page items must be decoded");
  assert.equal(entry.item.name, "Azure Bluet");
  assert.equal(entry.decode_error, null);
  assert.equal(entry.data, undefined, "raw blob must not ship");
  assert.equal(entry.blob, undefined, "internal blob ref must not ship");
  assert.equal(museum.data.members[0].value, 1234);
  assert.equal(museum.data.members[0].total_entries, 2, "one items entry plus one special");
}
