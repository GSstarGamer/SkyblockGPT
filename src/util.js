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

export function createTruncationReport() {
  return { truncated: false, reasons: [] };
}

function noteTruncation(report, reason) {
  if (!report) return;
  report.truncated = true;
  if (!report.reasons.includes(reason)) report.reasons.push(reason);
}

export function sanitize(value, depth = 5, maxEntries = 300, report = null) {
  if (value === null || value === undefined) return value ?? null;
  if (depth <= 0) {
    noteTruncation(report, "depth");
    return "[omitted]";
  }
  if (["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "string" && value.length > 2_000) {
      noteTruncation(report, "string");
      return `${value.slice(0, 2_000)}…`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    const cap = Math.min(maxEntries, 250);
    if (value.length > cap) noteTruncation(report, "array");
    return value.slice(0, cap).map((item) => sanitize(item, depth - 1, maxEntries, report));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > maxEntries) noteTruncation(report, "object");
    const result = {};
    for (const [key, item] of entries.slice(0, maxEntries)) {
      result[key] = sanitize(item, depth - 1, maxEntries, report);
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
