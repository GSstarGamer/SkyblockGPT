async function mapInBatches(values, batchSize, mapper) {
  const results = [];
  for (let index = 0; index < values.length; index += batchSize) {
    results.push(...await Promise.all(values.slice(index, index + batchSize).map(mapper)));
  }
  return results;
}

export function paginateRecords(records, page, limit) {
  const totalItems = records.length;
  const totalPages = totalItems ? Math.ceil(totalItems / limit) : 0;
  const start = page * limit;
  return {
    page,
    limit,
    total_items: totalItems,
    total_pages: totalPages,
    has_more: start + limit < totalItems,
    items: records.slice(start, start + limit),
  };
}

export function normalizeUnixMilliseconds(value) {
  const timestamp = optionalNumber(value);
  if (timestamp === null || timestamp < 0) return null;
  return timestamp < 100_000_000_000 ? timestamp * 1_000 : timestamp;
}

export function isoFromUnixMs(value) {
  const timestamp = optionalNumber(value);
  if (timestamp === null || timestamp < 0 || timestamp > 8_640_000_000_000_000) return null;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return null;
  }
}

export function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function firstNumber(...values) {
  for (const value of values) {
    const converted = optionalNumber(value);
    if (converted !== null) return converted;
  }
  return null;
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function pick(object, keys) {
  const result = {};
  for (const key of keys) {
    if (object && object[key] !== undefined) result[key] = object[key];
  }
  return sanitize(result, 5, 300);
}

export function sanitize(value, depth = 5, maxEntries = 300) {
  if (value === null || value === undefined) return value ?? null;
  if (depth <= 0) return "[omitted]";
  if (["string", "number", "boolean"].includes(typeof value)) {
    return typeof value === "string" && value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, Math.min(maxEntries, 250)).map((item) => sanitize(item, depth - 1, maxEntries));
  }
  if (typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, maxEntries)) {
      result[key] = sanitize(item, depth - 1, maxEntries);
    }
    return result;
  }
  return String(value);
}

export function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

export function number(value) {
  return optionalNumber(value) ?? 0;
}
