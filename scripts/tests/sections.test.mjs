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

  // section=pets must return an object, not the bare array Hypixel's
  // OpenAPI schema (CompactDataResponse.data: object) forbids. One pet has a
  // known rarity (must derive a leveled, sourced level); a second has no
  // tier at all (must report the level unavailable, never guess a ladder).
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
            pets_data: {
              pets: [
                { uuid: "pet-1", type: "ENDER_DRAGON", exp: 4_600_000, active: true, tier: "LEGENDARY", heldItem: null },
                { uuid: "pet-2", type: "SOME_PET", exp: 500, active: false },
              ],
            },
          },
        },
      }],
    }),
  });
  const petsResponse = await call(`/v1/player/section?uuid=${playerUuid}&section=pets`);
  const petsBody = await petsResponse.json();
  assert.equal(petsResponse.status, 200, JSON.stringify(petsBody));
  assert.equal(Array.isArray(petsBody.data), false, "section=pets must return an object, matching the OpenAPI contract");
  assert.equal(petsBody.data.available, true);
  assert.equal(petsBody.data.total_pets, 2);
  assert.equal(petsBody.data.returned, 2);
  assert.equal(petsBody.data.truncated, false);
  assert.equal(petsBody.data.pets.length, 2);
  assert.equal(petsBody.data.pets[0].exp, 4_600_000, "exp must survive alongside the new level field");

  const knownPetLevel = petsBody.data.pets[0].level;
  assert.equal(knownPetLevel.available, true, "a pet with a known rarity must derive a level");
  assert.notEqual(knownPetLevel.source_authority, null, "a known-rarity pet's level must carry its source authority");
  assert.ok(knownPetLevel.source_url, "a known-rarity pet's level must carry a source URL");

  const unknownPetLevel = petsBody.data.pets[1].level;
  assert.equal(unknownPetLevel.available, false, "a pet with no rarity must report its level unavailable, not guess a ladder");
  assert.equal(unknownPetLevel.source_authority, null);

  // Missing pet data entirely (no pets_data.pets, no pets) must read as
  // unavailable, not as an empty list presented as though the player has
  // zero pets.
  installMockFetch({
    "/v2/skyblock/profiles": () => Response.json({
      success: true,
      profiles: [{
        profile_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        cute_name: "Mango",
        selected: true,
        members: { [playerUuid]: { last_save: 100 } },
      }],
    }),
  });
  const noPetsResponse = await call(`/v1/player/section?uuid=${playerUuid}&section=pets`);
  const noPetsBody = await noPetsResponse.json();
  assert.equal(noPetsResponse.status, 200, JSON.stringify(noPetsBody));
  assert.equal(noPetsBody.data.available, false);
  assert.ok(noPetsBody.data.reason, "missing pet data must explain why, not just report available:false");
  assert.deepEqual(noPetsBody.data.pets, [], "still shaped as an object with an empty pets list, not a bare array");

  // section=slayers must derive a level for a known boss, carrying full
  // provenance (Hypixel publishes no slayer XP ladder itself).
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
            slayer: { slayer_bosses: { zombie: { xp: 1_000_000, claimed_levels: { level_1: true } } } },
          },
        },
      }],
    }),
  });
  const slayersResponse = await call(`/v1/player/section?uuid=${playerUuid}&section=slayers`);
  const slayersBody = await slayersResponse.json();
  assert.equal(slayersResponse.status, 200, JSON.stringify(slayersBody));
  const zombieLevel = slayersBody.data.zombie.level;
  assert.equal(zombieLevel.available, true, "a known slayer boss must derive a level");
  assert.equal(zombieLevel.level, 9, "1,000,000 XP is the top zombie threshold");
  assert.equal(zombieLevel.level_source, "static_table");
  assert.ok(zombieLevel.table_version);
  assert.equal(zombieLevel.source_authority, "wiki");
  assert.ok(zombieLevel.source_url);
  assert.equal(zombieLevel.verify_on_wiki, true);

  // section=dungeons must derive both a Catacombs level and a class level.
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
            dungeons: {
              selected_dungeon_class: "tank",
              dungeon_types: { catacombs: { experience: 50 } },
              player_classes: { tank: { experience: 50 } },
            },
          },
        },
      }],
    }),
  });
  const dungeonsResponse = await call(`/v1/player/section?uuid=${playerUuid}&section=dungeons`);
  const dungeonsBody = await dungeonsResponse.json();
  assert.equal(dungeonsResponse.status, 200, JSON.stringify(dungeonsBody));
  const catacombsLevel = dungeonsBody.data.dungeon_types.catacombs.level;
  assert.equal(catacombsLevel.available, true, "catacombs XP must derive a level");
  assert.equal(catacombsLevel.level, 1);
  assert.equal(catacombsLevel.source_authority, "wiki");
  const tankLevel = dungeonsBody.data.player_classes.tank.level;
  assert.equal(tankLevel.available, true, "class XP must derive a level");
  assert.equal(tankLevel.level, 1);
  assert.notEqual(tankLevel.source_authority, null);

  // bestiary's payload_truncated flag: false for a small, ordinary fixture...
  installMockFetch({
    "/v2/skyblock/profiles": () => Response.json({
      success: true,
      profiles: [{
        profile_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        cute_name: "Mango",
        selected: true,
        members: { [playerUuid]: { last_save: 100, bestiary: { zombie_kills: 5, spider_kills: 2 } } },
      }],
    }),
  });
  const bestiaryResponse = await call(`/v1/player/section?uuid=${playerUuid}&section=bestiary`);
  const bestiaryBody = await bestiaryResponse.json();
  assert.equal(bestiaryResponse.status, 200, JSON.stringify(bestiaryBody));
  assert.equal(bestiaryBody.data.payload_truncated, false, "a small bestiary fixture must not be flagged truncated");
  assert.equal(bestiaryBody.data.zombie_kills, 5, "bestiary payload must stay an unwrapped object with the new key added");

  // ...and true once the fixture genuinely exceeds sanitize's entry cap (700
  // at this depth).
  const wideBestiary = {};
  for (let i = 0; i < 701; i += 1) wideBestiary[`mob_${i}`] = i;
  installMockFetch({
    "/v2/skyblock/profiles": () => Response.json({
      success: true,
      profiles: [{
        profile_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        cute_name: "Mango",
        selected: true,
        members: { [playerUuid]: { last_save: 100, bestiary: wideBestiary } },
      }],
    }),
  });
  const wideBestiaryResponse = await call(`/v1/player/section?uuid=${playerUuid}&section=bestiary`);
  const wideBestiaryBody = await wideBestiaryResponse.json();
  assert.equal(wideBestiaryResponse.status, 200, JSON.stringify(wideBestiaryBody));
  assert.equal(wideBestiaryBody.data.payload_truncated, true, "an over-cap bestiary payload must be flagged truncated");
}
