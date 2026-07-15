import assert from "node:assert/strict";
import { call, installMockFetch, playerUuid } from "./_fixtures.mjs";

// A derived level's provenance must always be resolvable. Since 26de7b9
// hoisted provenance out of each item, that guarantee now runs through a
// `level` object's `ladder` pointer into the section's `level_provenance.
// ladders`, rather than through fields on the level object itself. This
// checks both directions: every pointer resolves to a real entry, and every
// entry is referenced by at least one item -- a dangling pointer or an
// unused entry both defeat the point of hoisting provenance in the first
// place.
function assertProvenanceResolves(levels, provenance, label) {
  const referenced = new Set();
  for (const level of levels) {
    if (!level.available) {
      assert.equal(level.ladder, undefined, `${label}: an unavailable level must not carry a ladder pointer`);
      continue;
    }
    assert.ok(level.ladder, `${label}: an available level must carry a ladder pointer`);
    assert.ok(
      provenance.ladders[level.ladder],
      `${label}: ladder "${level.ladder}" must resolve in level_provenance.ladders`
    );
    referenced.add(level.ladder);
  }
  for (const key of Object.keys(provenance.ladders)) {
    assert.ok(referenced.has(key), `${label}: level_provenance.ladders has unused entry "${key}"`);
  }
}

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

  // Provenance now lives once per response, in level_provenance, with each
  // pet pointing at the ladder it used.
  const petProvenance = petsBody.data.level_provenance;
  assert.equal(petProvenance.level_source, "static_table");
  assert.ok(petProvenance.table_version);
  assert.equal(petProvenance.verify_on_wiki, true);
  assertProvenanceResolves(petsBody.data.pets.map((pet) => pet.level), petProvenance, "pets");

  const knownPetLevel = petsBody.data.pets[0].level;
  assert.equal(knownPetLevel.available, true, "a pet with a known rarity must derive a level");
  assert.ok(knownPetLevel.ladder, "a known-rarity pet's level must carry a ladder pointer");
  const knownPetLadder = petProvenance.ladders[knownPetLevel.ladder];
  assert.notEqual(knownPetLadder.source_authority, null, "a known-rarity pet's ladder must carry its source authority");
  assert.ok(knownPetLadder.source_url, "a known-rarity pet's ladder must carry a source URL");

  const unknownPetLevel = petsBody.data.pets[1].level;
  assert.equal(unknownPetLevel.available, false, "a pet with no rarity must report its level unavailable, not guess a ladder");
  assert.equal(unknownPetLevel.ladder, undefined, "an unavailable pet level must not carry a ladder pointer");

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
  assert.deepEqual(
    noPetsBody.data.level_provenance.ladders, {},
    "no pets means no ladder was used, so level_provenance.ladders must be empty, not carry unused entries"
  );

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
  assert.ok(zombieLevel.ladder, "a known slayer boss's level must carry a ladder pointer");

  const slayerProvenance = slayersBody.data.level_provenance;
  assert.equal(slayerProvenance.level_source, "static_table");
  assert.ok(slayerProvenance.table_version);
  assert.equal(slayerProvenance.verify_on_wiki, true);
  assertProvenanceResolves([zombieLevel], slayerProvenance, "slayers");

  const zombieLadder = slayerProvenance.ladders[zombieLevel.ladder];
  assert.equal(zombieLadder.source_authority, "wiki");
  assert.ok(zombieLadder.source_url);

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
  assert.ok(catacombsLevel.ladder, "catacombs level must carry a ladder pointer");
  const tankLevel = dungeonsBody.data.player_classes.tank.level;
  assert.equal(tankLevel.available, true, "class XP must derive a level");
  assert.equal(tankLevel.level, 1);
  assert.ok(tankLevel.ladder, "class level must carry a ladder pointer");

  const dungeonProvenance = dungeonsBody.data.level_provenance;
  assertProvenanceResolves([catacombsLevel, tankLevel], dungeonProvenance, "dungeons");

  const catacombsLadder = dungeonProvenance.ladders[catacombsLevel.ladder];
  assert.equal(catacombsLadder.source_authority, "wiki");

  // dungeon_class is corroborated from a secondary, frozen wiki rather than
  // read directly off the authoritative wiki (see levels.js) -- the one
  // ladder here that must not claim pinned-wiki authority. Hoisting
  // source_authority up to level_provenance's top level (rather than keeping
  // it per-ladder) would silently relabel this as "wiki", so this is the
  // assertion that would catch that regression.
  const classLadder = dungeonProvenance.ladders[tankLevel.ladder];
  assert.equal(classLadder.source_authority, "corroborated_secondary", "dungeon_class must not claim wiki authority");
  assert.notEqual(classLadder.source_authority, "wiki");

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

  // A fixed pet-count cap cannot bound response bytes: size depends on what
  // each pet carries, not how many pets there are. compactPets used to cap
  // at a flat PET_PAGE_CAP (250), which only "worked" because its own test
  // fixture was unrealistically lean (uuid/type/tier/exp/active only). Real
  // pets commonly carry heldItem, and often skin and candyUsed too --
  // compactPets picks all three (see PET_FIELDS) -- so a real collector's
  // 250-pet profile 502'd against src/http.js's 80,000-char cap even though
  // the lean fixture passed comfortably. This fixture is the realistic case
  // that used to 502: 250 pets, each carrying heldItem, skin, and
  // candyUsed, with long, realistic identifiers throughout (full-length pet
  // UUIDs, a long real pet type name, the longest rarity string). It goes
  // through the actual worker response pipeline, including the same
  // 80,000-char enforcement in src/http.js every other route goes through,
  // not a hand-assembled approximation.
  const widePets = Array.from({ length: 250 }, (_, i) => ({
    uuid: `${String(i).padStart(8, "0")}-1111-2222-3333-444444444444`,
    type: "PROTECTOR_DRAGON",
    exp: 4_600_000 + i,
    active: i === 0,
    tier: "LEGENDARY",
    heldItem: "MINOS_RELIC",
    skin: "PROTECTOR_DRAGON_ANIMATED",
    candyUsed: 10,
  }));
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
            pets_data: { pets: widePets },
          },
        },
      }],
    }),
  });
  const widePetsResponse = await call(`/v1/player/section?uuid=${playerUuid}&section=pets`);
  const widePetsText = await widePetsResponse.text();
  assert.equal(widePetsResponse.status, 200, widePetsText);
  assert.ok(
    widePetsText.length < 80_000,
    `a 250-pet response with heldItem+skin+candyUsed must stay under the 80,000-char cap (measured ${widePetsText.length})`
  );
  const widePetsBody = JSON.parse(widePetsText);
  // total_pets always reports what Hypixel actually exposed, even when the
  // byte budget means fewer than that are returned -- reporting the
  // truncated count as the total would be exactly the "missing data
  // reported as fact" failure this project forbids.
  assert.equal(widePetsBody.data.total_pets, 250);
  assert.ok(
    widePetsBody.data.returned < 250,
    `a realistic 250-pet profile must be truncated by the byte budget, not returned in full (measured ${widePetsBody.data.returned})`
  );
  assert.equal(widePetsBody.data.truncated, true, "a realistic 250-pet profile must be flagged truncated");
  assert.equal(
    widePetsBody.data.truncation_reason, "response_size_budget",
    "truncation caused by the byte budget must say so, not just flip a boolean"
  );
  assert.equal(widePetsBody.data.pets.length, widePetsBody.data.returned);
  // The active pet (index 0 of the fixture) must survive truncation: it is
  // sorted to the front, so if truncation dropped it, the sort/truncation
  // ordering is broken, not just the byte accounting.
  assert.ok(
    widePetsBody.data.pets.some((pet) => pet.active === true),
    "an active pet must survive truncation, not be arbitrarily dropped"
  );
  assertProvenanceResolves(widePetsBody.data.pets.map((pet) => pet.level), widePetsBody.data.level_provenance, "wide pets");

  // A small, realistic fixture -- nowhere near the byte budget -- must not
  // be truncated at all: truncated must mean data was actually dropped, not
  // be a flag that fires regardless of size.
  const smallPets = Array.from({ length: 3 }, (_, i) => ({
    uuid: `${String(i).padStart(8, "0")}-1111-2222-3333-444444444444`,
    type: "PROTECTOR_DRAGON",
    exp: 4_600_000 + i,
    active: i === 0,
    tier: "LEGENDARY",
    heldItem: "MINOS_RELIC",
    skin: "PROTECTOR_DRAGON_ANIMATED",
    candyUsed: 10,
  }));
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
            pets_data: { pets: smallPets },
          },
        },
      }],
    }),
  });
  const smallPetsResponse = await call(`/v1/player/section?uuid=${playerUuid}&section=pets`);
  const smallPetsBody = await smallPetsResponse.json();
  assert.equal(smallPetsResponse.status, 200, JSON.stringify(smallPetsBody));
  assert.equal(smallPetsBody.data.total_pets, 3);
  assert.equal(smallPetsBody.data.returned, 3, "a small fixture well under budget must return every pet");
  assert.equal(smallPetsBody.data.returned, smallPetsBody.data.total_pets);
  assert.equal(smallPetsBody.data.truncated, false, "a small fixture must not be flagged truncated");
  assert.equal(smallPetsBody.data.truncation_reason, null, "an untruncated response must not carry a truncation reason");
}
