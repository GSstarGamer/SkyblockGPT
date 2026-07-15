import assert from "node:assert/strict";
import { createTruncationReport, sanitize } from "../../src/util.js";

export async function run() {
  // Omitting the report preserves existing behavior exactly.
  assert.deepEqual(sanitize({ a: 1 }), { a: 1 });
  assert.equal(sanitize({ a: { b: { c: 1 } } }, 2).a.b, "[omitted]");

  // Untruncated input leaves the report clean.
  const clean = createTruncationReport();
  sanitize({ a: 1, b: "short" }, 5, 300, clean);
  assert.equal(clean.truncated, false);
  assert.deepEqual(clean.reasons, []);

  // Depth cutoff is reported.
  const depth = createTruncationReport();
  sanitize({ a: { b: { c: 1 } } }, 2, 300, depth);
  assert.equal(depth.truncated, true);
  assert.deepEqual(depth.reasons, ["depth"]);

  // Array slicing is reported.
  const array = createTruncationReport();
  const sliced = sanitize(Array.from({ length: 300 }, (_, i) => i), 5, 300, array);
  assert.equal(sliced.length, 250);
  assert.equal(array.truncated, true);
  assert.deepEqual(array.reasons, ["array"]);

  // Object entry slicing is reported.
  const object = createTruncationReport();
  sanitize(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i])), 5, 4, object);
  assert.equal(object.truncated, true);
  assert.deepEqual(object.reasons, ["object"]);

  // String clamping is reported.
  const string = createTruncationReport();
  sanitize({ long: "x".repeat(2_500) }, 5, 300, string);
  assert.equal(string.truncated, true);
  assert.deepEqual(string.reasons, ["string"]);

  // Reasons are deduplicated, not repeated per occurrence.
  const many = createTruncationReport();
  sanitize([Array.from({ length: 300 }), Array.from({ length: 300 })], 5, 300, many);
  assert.deepEqual(many.reasons, ["array"]);
}
