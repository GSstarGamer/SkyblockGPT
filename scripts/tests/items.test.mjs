import assert from "node:assert/strict";
import { findNbtContainers } from "../../src/items.js";
import { itemNbt } from "./_fixtures.mjs";

export async function run() {
  // A factory, not a shared object: findNbtContainers guards recursion with a
  // `visited` WeakSet keyed by identity, so reusing one blob reference across
  // containers would make it skip all but the first. Real payloads come from
  // JSON.parse, which yields a distinct object per container.
  const blob = () => ({ type: 0, data: itemNbt });
  const containers = findNbtContainers({
    inventory: {
      inv_contents: blob(),
      backpack_contents: { 0: blob() },
      backpack_icons: { 0: blob() },
    },
  });
  const ids = containers.map((entry) => entry.id);

  assert.ok(ids.includes("inventory.inv_contents"), "main inventory must be indexed");
  assert.ok(ids.includes("inventory.backpack_contents.0"), "real backpacks must be indexed");
  assert.ok(
    !ids.some((id) => id.includes("backpack_icons")),
    "backpack_icons are display icons, not containers",
  );
  assert.equal(
    containers.filter((entry) => entry.kind === "backpack").length,
    1,
    "only the real backpack counts",
  );
}
