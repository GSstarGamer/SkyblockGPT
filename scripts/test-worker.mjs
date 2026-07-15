import { run as runHealth } from "./tests/health.test.mjs";
import { run as runPlayer } from "./tests/player.test.mjs";
import { run as runMarket } from "./tests/market.test.mjs";
import { run as runCache } from "./tests/cache.test.mjs";
import { run as runSections } from "./tests/sections.test.mjs";
import { run as runUtil } from "./tests/util.test.mjs";
import { run as runItems } from "./tests/items.test.mjs";
import { run as runLevels } from "./tests/levels.test.mjs";

const suites = [
  ["health", runHealth],
  ["player", runPlayer],
  ["market", runMarket],
  ["cache", runCache],
  ["sections", runSections],
  ["util", runUtil],
  ["items", runItems],
  ["levels", runLevels],
];

let failed = 0;
for (const [name, run] of suites) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failed) {
  console.error(`\n${failed} suite(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${suites.length} suites passed.`);
