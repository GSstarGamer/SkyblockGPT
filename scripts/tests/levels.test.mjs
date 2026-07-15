import assert from "node:assert/strict";
import { levelFromLadder } from "../../src/levels.js";

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

  // Missing XP is unavailable, never zero (AGENTS.md rule 5).
  const missing = levelFromLadder(null, ladder, options);
  assert.equal(missing.level, null);
  assert.equal(missing.experience, null);
  assert.equal(missing.available, false);

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
}
