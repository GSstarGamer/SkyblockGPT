import { optionalNumber, round } from "./util.js";

// Hypixel publishes level thresholds for skills only, via
// /v2/resources/skyblock/skills. Slayer, catacombs, dungeon classes and pets
// have no resource endpoint, so their ladders are static tables transcribed
// from the official wiki. That makes this the one place the Worker reports a
// number no API gave it, so every derived level carries provenance:
// level_source, table_version, and verify_on_wiki.

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
