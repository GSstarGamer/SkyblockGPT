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

  // A small, ordinary fixture must not be flagged truncated — a flag that is
  // always true is as useless as no flag at all.
  assert.equal(stats.data.lifetime_counters_truncated, false, "small player_stats must not be flagged truncated");

  // A player_stats payload that genuinely exceeds sanitize's entry cap (900
  // at this depth) must flip the flag to true. This fails if the report
  // plumbing is removed from compactStats's lifetime_counters call.
  const wideStats = {};
  for (let i = 0; i < 901; i += 1) wideStats[`stat_${i}`] = i;
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
            player_stats: wideStats,
          },
        },
      }],
    }),
  });
  const wideResponse = await call(`/v1/player/section?uuid=${playerUuid}&section=stats`);
  const wideStatsBody = await wideResponse.json();
  assert.equal(wideResponse.status, 200, JSON.stringify(wideStatsBody));
  assert.equal(wideStatsBody.data.lifetime_counters_truncated, true, "an over-cap player_stats must be flagged truncated");

  // Museum decodes the paginated page and never ships raw base64.
  installMockFetch();
  const museumResponse = await call(`/v1/player/extra?uuid=${playerUuid}&kind=museum`);
  const museum = await museumResponse.json();
  assert.equal(museumResponse.status, 200, JSON.stringify(museum));

  // The museum key is the donated item's ID; the blob is its NBT. The shared
  // fixture blob decodes to RED_ROSE:3 ("Azure Bluet") — verified, not assumed.
  const entry = museum.data.items[0];
  assert.equal(entry.item_id, "ZOMBIE_SWORD", "museum key is preserved");
  assert.ok(Array.isArray(entry.decoded_items), "decoded_items must be a list, not just the first record");
  assert.equal(entry.decoded_items[0].skyblock_id, "RED_ROSE:3", "page items must be decoded");
  assert.equal(entry.decoded_items[0].name, "Azure Bluet");
  assert.equal(entry.blob_present, true, "a decodable blob must report presence");
  assert.equal(entry.decode_error, null);
  assert.equal(entry.decoded_items_truncated, false, "a single-item blob must not be flagged as truncated");
  assert.equal(entry.item, undefined, "the old singular item field must be gone");
  assert.equal(entry.data, undefined, "raw blob must not ship");
  assert.equal(entry.blob, undefined, "internal blob ref must not ship");
  assert.equal(museum.data.members[0].value, 1234);
  assert.equal(museum.data.members[0].total_entries, 2, "one items entry plus one special");

  // compactGarden wraps the whole returned object in sanitize. A small,
  // ordinary garden payload must not be flagged truncated.
  installMockFetch({
    "/v2/skyblock/garden": () => Response.json({
      success: true,
      garden: { uuid: playerUuid, garden_experience: 5_000, unlocked_plots_ids: ["beginner_1"] },
    }),
  });
  const gardenResponse = await call(`/v1/player/extra?uuid=${playerUuid}&kind=garden`);
  const garden = await gardenResponse.json();
  assert.equal(gardenResponse.status, 200, JSON.stringify(garden));
  assert.equal(garden.data.garden_truncated, false, "a small garden payload must not be flagged truncated");
  assert.equal(garden.data.garden_experience, 5_000, "sibling fields must survive alongside the new flag");

  // A garden payload that genuinely exceeds sanitize's array cap (250 at
  // this depth) must flip the flag to true. This fails if the report
  // plumbing is removed from compactGarden's sanitize call.
  installMockFetch({
    "/v2/skyblock/garden": () => Response.json({
      success: true,
      garden: {
        uuid: playerUuid,
        garden_experience: 5_000,
        unlocked_plots_ids: Array.from({ length: 251 }, (_, i) => `plot_${i}`),
      },
    }),
  });
  const wideGardenResponse = await call(`/v1/player/extra?uuid=${playerUuid}&kind=garden`);
  const wideGarden = await wideGardenResponse.json();
  assert.equal(wideGardenResponse.status, 200, JSON.stringify(wideGarden));
  assert.equal(wideGarden.data.garden_truncated, true, "an over-cap garden payload must be flagged truncated");
}
