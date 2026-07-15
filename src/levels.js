import { optionalNumber, round } from "./util.js";

// Hypixel publishes level thresholds for skills only, via
// /v2/resources/skyblock/skills. Slayer, catacombs, dungeon classes and pets
// have no resource endpoint, so their ladders are static tables transcribed
// from the official wiki. That makes this the one place the Worker reports a
// number no API gave it, so every derived level carries provenance:
// level_source, table_version, and verify_on_wiki.

// ---------------------------------------------------------------------------
// Sourced ladders. Every number below was read from the wiki page cited above
// it on 2026-07-15 and cross-checked against an independent statement on the
// same wiki (see scripts/tests/levels.test.mjs anchors). Nothing here is
// reconstructed from memory or from a remembered formula.
//
// Bump TABLE_VERSION on any change, and re-verify against the source page when
// Hypixel adjusts a ladder. Every consumer reports verify_on_wiki: true for
// this reason.
//
// All ladders are CUMULATIVE totals, matching levelFromLadder: ladder[0] is the
// total XP to reach level 1, ladder[1] the total to reach level 2, and so on.
// Where a source published incremental "XP for this level" values instead, the
// conversion to running totals is done here and called out in the comment.
// ---------------------------------------------------------------------------

export const TABLE_VERSION = "2026-07-15";

// Source: https://hypixelskyblock.minecraft.wiki/Slayer (section "Leveling Slayer")
// The source table is already CUMULATIVE: its "LVL n" column is the running
// total to reach level n, not the step from n-1. Confirmed against two
// independent figures on the same wiki: Tier IV Revenant Horror awards 500
// slayer XP (https://hypixelskyblock.minecraft.wiki/Revenant_Horror) and the
// Slayer page's own trivia states 2,000 Tier IV quests reach LVL 9 at a cost of
// 100m coins (Tier IV costs 50k, and 2,000 x 50k = 100m). 2,000 x 500 = the
// 1,000,000 below exactly; reading the column as incremental would total
// 1,526,220 and need 3,053 quests, contradicting the wiki.
// Per-boss values cross-checked on the individual boss pages, e.g.
// https://hypixelskyblock.minecraft.wiki/Zombie_Slayer ("XP required" column)
// and https://hypixelskyblock.minecraft.wiki/Vampire_Slayer.
// Vampire stops at 5 tiers; every other boss has 9.
export const SLAYER_LADDERS = {
  zombie: [5, 15, 200, 1000, 5000, 20000, 100000, 400000, 1000000],
  spider: [5, 25, 200, 1000, 5000, 20000, 100000, 400000, 1000000],
  wolf: [10, 30, 250, 1500, 5000, 20000, 100000, 400000, 1000000],
  enderman: [10, 30, 250, 1500, 5000, 20000, 100000, 400000, 1000000],
  blaze: [10, 30, 250, 1500, 5000, 20000, 100000, 400000, 1000000],
  vampire: [20, 75, 240, 840, 2400],
};

// Source: https://hypixelskyblock.minecraft.wiki/Dungeoneering/Leveling_Rewards
// (transcluded onto https://hypixelskyblock.minecraft.wiki/Dungeoneering)
// That table publishes BOTH an incremental "XP > Level" column and a cumulative
// "XP > Total" column. These are the "Total" values, copied directly, so no
// conversion was needed. Verified two ways: the table's own incremental column
// running-sums to its Total column on all 51 rows, and the Dungeoneering trivia
// notes that 2^31-1 XP corresponds to Catacombs 57 "about 89% to 58", which the
// values below reproduce at 88.84% using the post-50 rule.
export const CATACOMBS_LADDER = [
  50, 125, 235, 395, 625,
  955, 1425, 2095, 3045, 4385,
  6275, 8940, 12700, 17960, 25340,
  35640, 50040, 70040, 97640, 135640,
  188140, 259640, 356640, 488640, 668640,
  911640, 1239640, 1684640, 2284640, 3084640,
  4149640, 5559640, 7459640, 9959640, 13259640,
  17559640, 23159640, 30359640, 39559640, 51559640,
  66559640, 85559640, 109559640, 139559640, 177559640,
  225559640, 285559640, 360559640, 453559640, 569809640
];

// Source: https://hypixelskyblock.minecraft.wiki/Dungeoneering
// "Dungeon skills can be leveled up to level L (50). After level 50, players can
// gain further, cosmetic levels every 200 million XP. This also applies to class
// levels." Catacombs levels past 50 are cosmetic and have no published cap (the
// highest reached by any player as of July 2026 is 156), so CATACOMBS_LADDER
// stops at the last threshold the wiki actually tabulates and the flat post-50
// step is exposed separately rather than invented out to an arbitrary level.
export const CATACOMBS_COSMETIC_LEVEL_XP = 200000000;

// DUNGEON_CLASS_LADDER is deliberately absent: the wiki does not publish one.
// See scripts/tests/levels.test.mjs and the Task 8 report. The class pages
// (https://hypixelskyblock.minecraft.wiki/Classes, /Healer, /Dungeoneering and
// its only subpages /Leveling_Rewards and /Skill_UI) publish per-level *rewards*
// and confirm class level 1 costs 50 XP, the same cap of 50, and the same
// 200m post-50 step as Catacombs -- but they never tabulate class thresholds for
// levels 2-50, and never state that they equal the Catacombs thresholds.
// Aliasing this to CATACOMBS_LADDER would be an inference shipped under
// level_source: "static_table" and verify_on_wiki: true, which is exactly the
// kind of unsourced number this module exists to avoid. A missing ladder is a
// known gap; a wrong one silently misreports every class level.

// Source: https://hypixelskyblock.minecraft.wiki/Module:Pet/LevelingData
// (the data module behind https://hypixelskyblock.minecraft.wiki/Pets section
// "Pet Leveling"; itself attributed to NotEnoughUpdates-REPO constants/pets.json)
// The source is INCREMENTAL and is converted to running totals below. Its own
// renderer labels the column "XP needed to upgrade this pet from its previous
// level" (https://hypixelskyblock.minecraft.wiki/Module:Pet), and its _calcXP
// sums levels[from+1..to], confirming each entry is a step, not a total.
// A pet starts at level 1 with 0 XP, so each ladder begins at 0.
// Verified against the worked example on the Pets page: "a Rare pet with 4.6
// million cumulative XP (level 86) will be adjusted to level 81 when it is
// upgraded to Epic" -- these ladders reproduce both 86 and 81 exactly.
const PET_XP_CURVE = [
  100, 110, 120, 130, 145, 160, 175,
  190, 210, 230, 250, 275, 300, 330,
  360, 400, 440, 490, 540, 600, 660,
  730, 800, 880, 960, 1050, 1150, 1260,
  1380, 1510, 1650, 1800, 1960, 2130, 2310,
  2500, 2700, 2920, 3160, 3420, 3700, 4000,
  4350, 4750, 5200, 5700, 6300, 7000, 7800,
  8700, 9700, 10800, 12000, 13300, 14700, 16200,
  17800, 19500, 21300, 23200, 25200, 27400, 29800,
  32400, 35200, 38200, 41400, 44800, 48400, 52200,
  56200, 60400, 64800, 69400, 74200, 79200, 84700,
  90700, 97200, 104200, 111700, 119700, 128200, 137200,
  146700, 156700, 167700, 179700, 192700, 206700, 221700,
  237700, 254700, 272700, 291700, 311700, 333700, 357700,
  383700, 411700, 441700, 476700, 516700, 561700, 611700,
  666700, 726700, 791700, 861700, 936700, 1016700, 1101700,
  1191700, 1286700, 1386700, 1496700, 1616700, 1746700, 1886700
];

// Source: https://hypixelskyblock.minecraft.wiki/Module:Pet/LevelingData
// Each rarity reads the same curve from a different offset, and every rarity
// caps at level 100. Legendary and Mythic share an offset, so their ladders are
// identical -- that is what the source says, not a copy/paste slip.
const PET_RARITY_OFFSET = {
  common: 0,
  uncommon: 6,
  rare: 11,
  epic: 16,
  legendary: 20,
  mythic: 20,
};

function cumulativeFrom(steps) {
  const ladder = [];
  let total = 0;
  for (const step of steps) {
    total += step;
    ladder.push(total);
  }
  return ladder;
}

export const PET_LADDERS = Object.fromEntries(
  Object.entries(PET_RARITY_OFFSET).map(([rarity, offset]) => [
    rarity,
    // 0 for level 1, then 99 steps for levels 2..100.
    cumulativeFrom([0, ...PET_XP_CURVE.slice(offset, offset + 99)]),
  ]),
);

// Source: https://hypixelskyblock.minecraft.wiki/Golden_Dragon_Pet
// GOLDEN_DRAGON does use its own ladder: it is the Legendary curve for levels
// 1-100, extended to 200. The extension's odd-looking values are documented game
// behaviour, not placeholders:
//   - level 100 costs 0, because "a level 100 Golden Dragon can never exist as
//     the EXP requirement is 0, skipping it" -- the egg hatches straight into
//     level 101. This makes the level 100 and 101 totals identical; the ladder is
//     non-strictly-ascending here, and levelFromLadder's strict "xp < threshold"
//     comparison correctly reports 101 rather than 100.
//   - level 102 costs exactly 5,555: "only 5,555 EXP is needed specifically to
//     get it from level 101 to 102".
//   - "Upon going above Level 102, each level requires the same Pet Experience as
//     a pet going from Level 99 to Level 100", i.e. the last Legendary step.
// Per https://hypixelskyblock.minecraft.wiki/Jade_Dragon_Pet and
// https://hypixelskyblock.minecraft.wiki/Rose_Dragon_Pet, those two pets describe
// the identical mechanic and share this ladder; only the Golden Dragon page
// states the 5,555 figure explicitly.
export const GOLDEN_DRAGON_LADDER = (() => {
  const legendarySteps = [0, ...PET_XP_CURVE.slice(20, 20 + 99)];
  const lastLegendaryStep = legendarySteps[99];
  const beyond = [0, 5555];
  while (legendarySteps.length + beyond.length < 200) {
    beyond.push(lastLegendaryStep);
  }
  return cumulativeFrom([...legendarySteps, ...beyond]);
})();

function unavailable(experience, tableVersion) {
  return {
    available: false,
    experience: experience ?? null,
    level: null,
    level_with_progress: null,
    max_level: null,
    xp_into_level: null,
    xp_for_next_level: null,
    progress_to_next_level: null,
    level_source: "static_table",
    table_version: tableVersion,
    verify_on_wiki: true,
  };
}

/**
 * Resolve a level from an ascending array of cumulative XP thresholds.
 *
 * @param {number|null} experience Total accumulated XP, or null when the API did not expose it.
 * @param {number[]} ladder Cumulative XP required to reach level 1, 2, 3, ...
 * @param {{ maxLevel?: number, tableVersion: string }} options
 */
export function levelFromLadder(experience, ladder, options) {
  const tableVersion = options?.tableVersion || "unknown";
  const xp = optionalNumber(experience);
  if (xp === null || !Array.isArray(ladder) || !ladder.length) {
    return unavailable(xp, tableVersion);
  }

  const maxLevel = optionalNumber(options?.maxLevel) ?? ladder.length;
  let level = 0;
  let currentThreshold = 0;
  let nextThreshold = null;

  // Stop at maxLevel. Walking a ladder longer than the cap would leave
  // currentThreshold on a level past the one being reported, detaching
  // xp_into_level and progress from the level they describe.
  for (const [index, threshold] of ladder.entries()) {
    if (index + 1 > maxLevel) break;
    if (xp < threshold) {
      nextThreshold = threshold;
      break;
    }
    level = index + 1;
    currentThreshold = threshold;
  }

  const cappedLevel = Math.min(level, maxLevel);
  const atMax = cappedLevel >= maxLevel || nextThreshold === null;
  const xpIntoLevel = Math.max(0, xp - currentThreshold);
  const xpForNextLevel = atMax ? null : nextThreshold - currentThreshold;
  const progress = xpForNextLevel && xpForNextLevel > 0
    ? Math.max(0, Math.min(1, xpIntoLevel / xpForNextLevel))
    : 0;

  return {
    available: true,
    experience: xp,
    level: cappedLevel,
    level_with_progress: round(cappedLevel + (atMax ? 0 : progress), 4),
    max_level: maxLevel,
    xp_into_level: xpIntoLevel,
    xp_for_next_level: xpForNextLevel,
    progress_to_next_level: atMax ? 1 : round(progress, 6),
    level_source: "static_table",
    table_version: tableVersion,
    verify_on_wiki: true,
  };
}
