import {
  objectOrEmpty,
  optionalNumber,
  paginateRecords,
  pick,
  sanitize,
} from "../util.js";
import { json } from "../http.js";
import {
  readDetailParameter,
  readIntegerParameter,
  readTextParameter,
  requireEnumParameter,
} from "../params.js";
import { fetchHypixelJson } from "../hypixel.js";
import { compactCollectionItem, flattenCollections } from "../sections.js";

const RESOURCE_KINDS = new Set(["collections", "skills", "items", "election", "bingo"]);
const FEED_KINDS = new Set(["news", "firesales"]);

export async function handleResources(url, env) {
  const kind = requireEnumParameter(url, "kind", RESOURCE_KINDS);
  const detail = readDetailParameter(url);
  const query = readTextParameter(url, "query", 100, "").toLowerCase();
  const page = readIntegerParameter(url, "page", 0, 0, 10_000);
  const requestedLimit = readIntegerParameter(url, "limit", 25, 1, 50);
  const limit = detail === "full" ? Math.min(requestedLimit, 10) : requestedLimit;
  const cacheSeconds = kind === "election" ? 60 : kind === "bingo" ? 300 : 21_600;
  const payload = await fetchHypixelJson(`/v2/resources/skyblock/${kind}`, env, {}, {
    authenticated: false,
    cacheSeconds,
  });

  if (kind === "election" || kind === "bingo") {
    return json({
      success: true,
      kind,
      data: sanitize(payload, 9, 1_500),
    });
  }

  let records;
  if (kind === "items") {
    records = (Array.isArray(payload.items) ? payload.items : [])
      .filter((item) => resourceRecordMatches(item, query))
      .sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")))
      .map((item) => detail === "full" ? sanitize(item, 8, 500) : compactResourceItem(item));
  } else if (kind === "collections") {
    records = flattenCollections(payload.collections || {})
      .filter((item) => resourceRecordMatches(item, query))
      .sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")))
      .map((item) => detail === "full" ? sanitize(item, 8, 500) : compactCollectionItem(item));
  } else {
    records = Object.entries(payload.skills || {})
      .map(([id, value]) => ({ id, ...objectOrEmpty(value) }))
      .filter((item) => resourceRecordMatches(item, query))
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => sanitize(item, detail === "full" ? 8 : 5, detail === "full" ? 500 : 150));
  }

  return json({
    success: true,
    kind,
    data: {
      source_last_updated: optionalNumber(payload.lastUpdated),
      source_version: payload.version || null,
      query: query || null,
      detail,
      ...paginateRecords(records, page, limit),
    },
  });
}

export async function handleFeed(url, env) {
  const kind = requireEnumParameter(url, "kind", FEED_KINDS);
  const endpoint = kind === "news" ? "/v2/skyblock/news" : "/v2/skyblock/firesales";
  const payload = await fetchHypixelJson(endpoint, env, {}, {
    authenticated: false,
    cacheSeconds: kind === "news" ? 300 : 60,
  });

  return json({
    success: true,
    kind,
    data: kind === "news"
      ? { items: sanitize(payload.items || [], 7, 300) }
      : { sales: sanitize(payload.sales || [], 7, 300) },
  });
}

function compactResourceItem(item) {
  return sanitize(pick(item, [
    "id", "name", "material", "category", "tier", "npc_sell_price", "color", "stats", "soulbound", "museum", "generator", "furniture", "glowing",
  ]), 6, 200);
}

function resourceRecordMatches(record, query) {
  if (!query) return true;
  const id = String(record?.id || "").toLowerCase();
  const name = String(record?.name || "").toLowerCase();
  return id.includes(query) || name.includes(query);
}
