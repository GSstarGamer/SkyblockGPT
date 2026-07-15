import assert from "node:assert/strict";
import * as levels from "../../src/levels.js";
import {
  CATACOMBS_COSMETIC_LEVEL_XP,
  CATACOMBS_LADDER,
  DUNGEON_CLASS_LADDER,
  GOLDEN_DRAGON_LADDER,
  LADDER_AUTHORITY,
  LADDER_AUTHORITY_CORROBORATED,
  LADDER_AUTHORITY_WIKI,
  LADDER_SOURCES,
  PET_LADDERS,
  SLAYER_LADDERS,
  TABLE_VERSION,
  levelFromLadder,
} from "../../src/levels.js";

export async function run() {
  // Cumulative thresholds: level 1 at 100, level 2 at 300, level 3 at 600.
  const ladder = [100, 300, 600];
  const options = { maxLevel: 3, tableVersion: "test-1" };

  // Below the first threshold is level 0, not level 1.
  const zero = levelFromLadder(50, ladder, options);
  assert.equal(zero.level, 0);
  assert.equal(zero.xp_into_level, 50);
  assert.equal(zero.xp_for_next_level, 100);
  assert.equal(zero.progress_to_next_level, 0.5);

  // Exactly on a threshold counts as achieved.
  assert.equal(levelFromLadder(100, ladder, options).level, 1);
  assert.equal(levelFromLadder(299, ladder, options).level, 1);
  assert.equal(levelFromLadder(300, ladder, options).level, 2);

  // Mid-level progress is measured within the current band.
  const mid = levelFromLadder(400, ladder, options);
  assert.equal(mid.level, 2);
  assert.equal(mid.xp_into_level, 100, "400 - 300");
  assert.equal(mid.xp_for_next_level, 300, "600 - 300");
  assert.equal(mid.level_with_progress, 2.3333);

  // At max: no next level, progress saturates, overflow XP is preserved.
  const max = levelFromLadder(900, ladder, options);
  assert.equal(max.level, 3);
  assert.equal(max.max_level, 3);
  assert.equal(max.xp_for_next_level, null);
  assert.equal(max.progress_to_next_level, 1);
  assert.equal(max.xp_into_level, 300, "overflow past the cap is kept");
  assert.equal(max.level_with_progress, 3);

  // Provenance rides on every derived level: this data came from no API.
  assert.equal(max.level_source, "static_table");
  assert.equal(max.table_version, "test-1");
  assert.equal(max.verify_on_wiki, true);

  // Authority and source URL default to unknown when options omit them.
  // Undeclared provenance must read as unknown, never as a confident claim of
  // wiki authority -- this is the fail-safe guarantee: it must fail here if
  // the old "wiki" default is ever reintroduced.
  assert.equal(max.source_authority, null, "authority defaults to null, not wiki");
  assert.equal(max.source_url, null, "source_url defaults to null");

  // A caller can declare a different authority and cite a source page.
  const corroborated = levelFromLadder(400, ladder, {
    maxLevel: 3,
    tableVersion: "test-1",
    authority: LADDER_AUTHORITY_CORROBORATED,
    sourceUrl: "https://example.test/source",
  });
  assert.equal(corroborated.source_authority, LADDER_AUTHORITY_CORROBORATED);
  assert.equal(corroborated.source_url, "https://example.test/source");

  // Missing XP is unavailable, never zero (AGENTS.md rule 5).
  const missing = levelFromLadder(null, ladder, options);
  assert.equal(missing.level, null);
  assert.equal(missing.experience, null);
  assert.equal(missing.available, false);

  // Unavailable results must not silently drop provenance either, and must
  // default to unknown for the same fail-safe reason as the available path.
  assert.equal(missing.source_authority, null, "unavailable defaults to null, not wiki authority");
  assert.equal(missing.source_url, null, "unavailable defaults to null source_url");

  const missingCorroborated = levelFromLadder(null, ladder, {
    ...options,
    authority: LADDER_AUTHORITY_CORROBORATED,
    sourceUrl: "https://example.test/source",
  });
  assert.equal(missingCorroborated.available, false);
  assert.equal(missingCorroborated.source_authority, LADDER_AUTHORITY_CORROBORATED);
  assert.equal(missingCorroborated.source_url, "https://example.test/source");

  // An empty ladder cannot derive anything and must say so.
  const empty = levelFromLadder(500, [], options);
  assert.equal(empty.level, null);
  assert.equal(empty.available, false);

  // A ladder longer than maxLevel must not measure progress from a threshold
  // past the reported level. Regression: xp_into_level was computed from the
  // uncapped scan position, yielding 50 (650-600) for a level-2 result instead
  // of 350 (650-300).
  const longLadder = [100, 300, 600, 1000];
  const capped = levelFromLadder(650, longLadder, { maxLevel: 2, tableVersion: "test-1" });
  assert.equal(capped.level, 2, "level must not exceed maxLevel");
  assert.equal(capped.xp_into_level, 350, "measured from level 2's own threshold, not level 3's");
  assert.equal(capped.xp_for_next_level, null, "capped level has no next level");
  assert.equal(capped.progress_to_next_level, 1);
  assert.equal(capped.level_with_progress, 2, "must not exceed maxLevel");
  assert.equal(capped.max_level, 2);

  // -------------------------------------------------------------------------
  // Anchors transcribed from the official wiki on 2026-07-15. Each asserts a
  // real threshold so a mistyped ladder fails here rather than silently
  // misreporting a level for every player who asks. Values come from the source
  // pages cited in src/levels.js -- never from recall.
  // -------------------------------------------------------------------------
  assert.equal(TABLE_VERSION, "2026-07-15");

  const at = (xp, ladder, maxLevel) =>
    levelFromLadder(xp, ladder, { maxLevel, tableVersion: TABLE_VERSION }).level;

  // --- Slayer: https://hypixelskyblock.minecraft.wiki/Slayer -----------------
  // Vampire has 5 tiers; every other boss has 9.
  assert.equal(SLAYER_LADDERS.zombie.length, 9, "zombie slayer has 9 tiers");
  assert.equal(SLAYER_LADDERS.spider.length, 9);
  assert.equal(SLAYER_LADDERS.wolf.length, 9);
  assert.equal(SLAYER_LADDERS.enderman.length, 9);
  assert.equal(SLAYER_LADDERS.blaze.length, 9);
  assert.equal(SLAYER_LADDERS.vampire.length, 5, "vampire slayer stops at 5 tiers");

  // Level-1 thresholds differ per boss: zombie/spider 5, wolf/enderman/blaze 10,
  // vampire 20.
  assert.equal(SLAYER_LADDERS.zombie[0], 5);
  assert.equal(SLAYER_LADDERS.spider[0], 5);
  assert.equal(SLAYER_LADDERS.wolf[0], 10);
  assert.equal(SLAYER_LADDERS.enderman[0], 10);
  assert.equal(SLAYER_LADDERS.blaze[0], 10);
  assert.equal(SLAYER_LADDERS.vampire[0], 20);

  // Zombie and spider diverge only at LVL 2 (15 vs 25).
  assert.equal(SLAYER_LADDERS.zombie[1], 15);
  assert.equal(SLAYER_LADDERS.spider[1], 25);

  // Mid-ladder and max anchors.
  assert.equal(SLAYER_LADDERS.zombie[4], 5000, "zombie LVL 5");
  assert.equal(SLAYER_LADDERS.wolf[3], 1500, "wolf LVL 4");
  assert.equal(SLAYER_LADDERS.vampire[2], 240, "vampire LVL 3");
  assert.equal(SLAYER_LADDERS.zombie[8], 1000000, "zombie LVL 9 (max)");
  assert.equal(SLAYER_LADDERS.blaze[8], 1000000, "blaze LVL 9 (max)");
  assert.equal(SLAYER_LADDERS.vampire[4], 2400, "vampire LVL 5 (max)");

  // The wiki's own trivia pins the cumulative reading: 2,000 Tier IV quests
  // reach LVL 9, and a Tier IV Revenant Horror awards 500 slayer XP.
  assert.equal(SLAYER_LADDERS.zombie[8] / 500, 2000, "2,000 T4 quests to LVL 9");

  assert.equal(at(4, SLAYER_LADDERS.zombie, 9), 0, "below LVL 1 is 0, not 1");
  assert.equal(at(5, SLAYER_LADDERS.zombie, 9), 1);
  assert.equal(at(1000000, SLAYER_LADDERS.zombie, 9), 9);
  assert.equal(at(2400, SLAYER_LADDERS.vampire, 5), 5);

  // --- Catacombs: /Dungeoneering/Leveling_Rewards ("XP > Total" column) ------
  assert.equal(CATACOMBS_LADDER.length, 50, "catacombs tabulates levels 1-50");
  assert.equal(CATACOMBS_LADDER[0], 50, "catacombs level 1");
  assert.equal(CATACOMBS_LADDER[1], 125, "catacombs level 2 total (50 + 75)");
  assert.equal(CATACOMBS_LADDER[24], 668640, "catacombs level 25");
  assert.equal(CATACOMBS_LADDER[49], 569809640, "catacombs level 50 (max)");
  assert.equal(at(49, CATACOMBS_LADDER, 50), 0);
  assert.equal(at(50, CATACOMBS_LADDER, 50), 1);
  assert.equal(at(569809640, CATACOMBS_LADDER, 50), 50);

  // The ladder must ascend, or levelFromLadder's scan is meaningless.
  for (let i = 1; i < CATACOMBS_LADDER.length; i += 1) {
    assert.ok(CATACOMBS_LADDER[i] > CATACOMBS_LADDER[i - 1], `catacombs ladder ascends at ${i}`);
  }

  // Independent check from the Dungeoneering trivia: 2^31-1 XP is Catacombs 57,
  // "about 89%" of the way to 58, given the flat 200m cosmetic step past 50.
  assert.equal(CATACOMBS_COSMETIC_LEVEL_XP, 200000000);
  const signed32Max = 2 ** 31 - 1;
  const level57 = CATACOMBS_LADDER[49] + 7 * CATACOMBS_COSMETIC_LEVEL_XP;
  const into58 = (signed32Max - level57) / CATACOMBS_COSMETIC_LEVEL_XP;
  assert.ok(into58 > 0.88 && into58 < 0.89, `2^31-1 sits ~89% into level 58, got ${into58}`);

  // --- Pets: /Module:Pet/LevelingData (incremental source, converted here) ---
  assert.deepEqual(
    Object.keys(PET_LADDERS).sort(),
    ["common", "epic", "legendary", "mythic", "rare", "uncommon"],
    "six pet rarities",
  );
  for (const [rarity, ladder] of Object.entries(PET_LADDERS)) {
    assert.equal(ladder.length, 100, `${rarity} pets cap at level 100`);
    assert.equal(ladder[0], 0, `${rarity} pets start at level 1 with 0 XP`);
  }

  // Level-2 thresholds are the first real step of each rarity's curve.
  assert.equal(PET_LADDERS.common[1], 100);
  assert.equal(PET_LADDERS.uncommon[1], 175);
  assert.equal(PET_LADDERS.rare[1], 275);
  assert.equal(PET_LADDERS.epic[1], 440);
  assert.equal(PET_LADDERS.legendary[1], 660);

  // Legendary and mythic read the same offset in the source, so they match.
  assert.deepEqual(PET_LADDERS.mythic, PET_LADDERS.legendary, "mythic shares the legendary curve");

  // Mid-ladder and max anchors.
  assert.equal(PET_LADDERS.common[49], 89285, "common pet level 50");
  assert.equal(PET_LADDERS.common[99], 5624785, "common pet level 100 (max)");
  assert.equal(PET_LADDERS.rare[99], 12626665, "rare pet level 100 (max)");
  assert.equal(PET_LADDERS.epic[99], 18608500, "epic pet level 100 (max)");
  assert.equal(PET_LADDERS.legendary[99], 25353230, "legendary pet level 100 (max)");

  // The Pets page worked example: "a Rare pet with 4.6 million cumulative XP
  // (level 86) will be adjusted to level 81 when it is upgraded to Epic." This
  // pins the incremental-to-cumulative conversion end to end.
  assert.equal(at(4600000, PET_LADDERS.rare, 100), 86, "rare pet at 4.6m XP is level 86");
  assert.equal(at(4600000, PET_LADDERS.epic, 100), 81, "same XP as epic is level 81");

  assert.equal(at(0, PET_LADDERS.common, 100), 1, "a fresh pet is level 1, not 0");
  assert.equal(at(99, PET_LADDERS.common, 100), 1);
  assert.equal(at(100, PET_LADDERS.common, 100), 2);

  // --- Golden Dragon: /Golden_Dragon_Pet ------------------------------------
  assert.equal(GOLDEN_DRAGON_LADDER.length, 200, "golden dragon reaches level 200");
  assert.equal(GOLDEN_DRAGON_LADDER[1], 660, "shares the legendary curve below 100");
  assert.equal(GOLDEN_DRAGON_LADDER[99], PET_LADDERS.legendary[99], "level 100 matches legendary");

  // "A level 100 Golden Dragon can never exist as the EXP requirement is 0,
  // skipping it": the level 100 and 101 totals are identical, and the engine
  // must report 101 at that XP.
  assert.equal(GOLDEN_DRAGON_LADDER[100], GOLDEN_DRAGON_LADDER[99], "level 100 costs 0 and is skipped");
  assert.equal(at(GOLDEN_DRAGON_LADDER[99], GOLDEN_DRAGON_LADDER, 200), 101, "level 100 never reported");

  // "Only 5,555 EXP is needed specifically to get it from level 101 to 102."
  assert.equal(GOLDEN_DRAGON_LADDER[101] - GOLDEN_DRAGON_LADDER[100], 5555, "101 -> 102 costs 5,555");

  // "Upon going above Level 102, each level requires the same Pet Experience as
  // a pet going from Level 99 to Level 100."
  const legendaryLastStep = PET_LADDERS.legendary[99] - PET_LADDERS.legendary[98];
  assert.equal(legendaryLastStep, 1886700);
  assert.equal(GOLDEN_DRAGON_LADDER[103] - GOLDEN_DRAGON_LADDER[102], legendaryLastStep);
  assert.equal(GOLDEN_DRAGON_LADDER[199] - GOLDEN_DRAGON_LADDER[198], legendaryLastStep);
  assert.equal(GOLDEN_DRAGON_LADDER[199], 210255385, "golden dragon level 200 (max)");

  // --- Dungeon classes: https://wiki.hypixel.net/Classes ---------------------
  // Anchors read from that page's "XP Required" table ("Total" column). This
  // ladder replaced a deliberate gap: hypixelskyblock.minecraft.wiki publishes no
  // class ladder, so it comes from a secondary, Hypixel-hosted wiki that also
  // publishes a separate Catacombs table matching CATACOMBS_LADDER on all 50
  // values. See the provenance comment in src/levels.js.
  assert.equal(DUNGEON_CLASS_LADDER.length, 50, "classes tabulate levels 1-50");
  assert.equal(DUNGEON_CLASS_LADDER[0], 50, "class level 1");
  assert.equal(DUNGEON_CLASS_LADDER[24], 668640, "class level 25");
  assert.equal(DUNGEON_CLASS_LADDER[49], 569809640, "class level 50 (max)");
  assert.equal(at(49, DUNGEON_CLASS_LADDER, 50), 0, "below level 1 is 0, not 1");
  assert.equal(at(50, DUNGEON_CLASS_LADDER, 50), 1);
  assert.equal(at(569809640, DUNGEON_CLASS_LADDER, 50), 50);

  for (let i = 1; i < DUNGEON_CLASS_LADDER.length; i += 1) {
    assert.ok(DUNGEON_CLASS_LADDER[i] > DUNGEON_CLASS_LADDER[i - 1], `class ladder ascends at ${i}`);
  }

  // The class and Catacombs ladders are equal -- a sourced fact, not an alias.
  // Both tables are transcribed independently from their own pages, so this is a
  // tripwire: if it ever fails, one of the two sources changed. Re-verify BOTH
  // against source and update the provenance comments. Do not delete this
  // assertion, and do not collapse either ladder into the other to satisfy it.
  assert.deepEqual(
    DUNGEON_CLASS_LADDER,
    CATACOMBS_LADDER,
    "class thresholds equal catacombs thresholds per wiki.hypixel.net/Classes",
  );
  assert.notEqual(
    DUNGEON_CLASS_LADDER,
    CATACOMBS_LADDER,
    "equal by value, but must stay a separate table so a catacombs-only fix cannot silently move class levels",
  );

  // Class data is the one ladder not from the authoritative wiki. A later phase
  // must be able to surface that rather than pass it off as wiki-sourced.
  assert.equal(levels.LADDER_AUTHORITY.catacombs, levels.LADDER_AUTHORITY_WIKI);
  assert.equal(levels.LADDER_AUTHORITY.dungeon_class, levels.LADDER_AUTHORITY_CORROBORATED);
  assert.notEqual(
    levels.LADDER_AUTHORITY.dungeon_class,
    levels.LADDER_AUTHORITY_WIKI,
    "class ladder must not claim wiki authority",
  );

  // A consumer wiring DUNGEON_CLASS_LADDER must pass its recorded authority, and
  // the result must actually carry it -- not silently fall back to the wiki
  // default. This is the assertion that would have caught the original bug: if
  // the authority option is ever dropped from levelFromLadder, this fails while
  // the LADDER_AUTHORITY map assertions above keep passing.
  const classResult = levelFromLadder(400, DUNGEON_CLASS_LADDER, {
    maxLevel: 50,
    tableVersion: TABLE_VERSION,
    authority: LADDER_AUTHORITY["dungeon_class"],
  });
  assert.equal(
    classResult.source_authority,
    "corroborated_secondary",
    "class ladder result must report corroborated_secondary authority",
  );
  assert.notEqual(
    classResult.source_authority,
    LADDER_AUTHORITY_WIKI,
    "class ladder result must not claim wiki authority",
  );

  // -------------------------------------------------------------------------
  // LADDER_SOURCES: every ladder bundled with the authority, source URL and
  // cap a caller needs, so a consumer cannot pair a ladder with the wrong
  // authority, forget the URL, or forget the option entirely.
  // -------------------------------------------------------------------------
  const validAuthorities = new Set([LADDER_AUTHORITY_WIKI, LADDER_AUTHORITY_CORROBORATED]);
  for (const [name, src] of Object.entries(LADDER_SOURCES)) {
    assert.ok(Array.isArray(src.ladder) && src.ladder.length > 0, `${name} has a real ladder`);
    assert.ok(src.sourceUrl, `${name} has a non-null sourceUrl`);
    assert.ok(
      validAuthorities.has(src.authority),
      `${name} authority is one of the two exported LADDER_AUTHORITY constants`,
    );
    assert.equal(
      src.maxLevel,
      src.ladder.length,
      `${name} maxLevel matches its ladder's actual length`,
    );
  }

  // The one entry that must not claim pinned-wiki authority: DUNGEON_CLASS_LADDER
  // came from wiki.hypixel.net, not hypixelskyblock.minecraft.wiki (AGENTS.md
  // rule 4), which publishes no class ladder at all.
  assert.equal(LADDER_SOURCES.dungeon_class.authority, LADDER_AUTHORITY_CORROBORATED);
  assert.ok(
    LADDER_SOURCES.dungeon_class.sourceUrl.includes("wiki.hypixel.net"),
    "dungeon_class source points at the secondary wiki, not the pinned one",
  );

  // A caller wiring LADDER_SOURCES cannot forget provenance: spreading an
  // entry into levelFromLadder must carry its declared authority and URL, not
  // fall back to the fail-safe null default.
  const fromSources = levelFromLadder(400, LADDER_SOURCES.slayer_vampire.ladder, {
    ...LADDER_SOURCES.slayer_vampire,
    tableVersion: TABLE_VERSION,
  });
  assert.equal(fromSources.source_authority, LADDER_AUTHORITY_WIKI);
  assert.equal(fromSources.source_url, "https://hypixelskyblock.minecraft.wiki/Slayer");
}
