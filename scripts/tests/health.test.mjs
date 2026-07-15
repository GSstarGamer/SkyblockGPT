import assert from "node:assert/strict";
import { call, installMockFetch, playerUuid } from "./_fixtures.mjs";

export async function run() {
  installMockFetch();

  const health = await (await call("/health", false)).json();
  assert.equal(health.success, true);
  assert.equal(health.version, "2.5.1");

  const unauthorized = await call(`/v1/player/profiles?uuid=${playerUuid}`, false);
  assert.equal(unauthorized.status, 401);
}
