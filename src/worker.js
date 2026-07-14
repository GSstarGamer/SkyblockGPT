import {
  number,
  objectOrEmpty,
  optionalNumber,
  paginateRecords,
  pick,
  sanitize,
} from "./util.js";
import { ClientError, json, privacyPolicy, UpstreamError } from "./http.js";
import {
  GENERIC_UUID_PATTERN,
  normalizeUuid,
  readDetailParameter,
  readIntegerParameter,
  readOptionalBooleanParameter,
  readTextParameter,
  requireEnumParameter,
  requireItemTag,
} from "./params.js";
import { fetchHypixelJson, fetchSkyBlockItemNameMap } from "./hypixel.js";
import { decodeInventoryBlob } from "./items.js";
import { compactCollectionItem, flattenCollections } from "./sections.js";
import {
  auctionPrice,
  binPrice,
  compactAuction,
  compactBazaarProduct,
  compactEndedAuction,
  compareBazaarProducts,
  normalizeItemSearchText,
  resolveSkyBlockItem,
  skyBlockItemIdsMatch,
} from "./market.js";
import {
  handlePlayerAccessories,
  handlePlayerCollections,
  handlePlayerExtra,
  handleProfiles,
  handleSacks,
  handleSection,
  handleSummary,
} from "./routes/player.js";
import {
  handleInventoryContainer,
  handleInventoryIndex,
  handleInventoryItem,
} from "./routes/inventory.js";

const RESOURCE_KINDS = new Set(["collections", "skills", "items", "election", "bingo"]);
const FEED_KINDS = new Set(["news", "firesales"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, X-GPT-Key",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        },
      });
    }

    if (request.method !== "GET") {
      return json({ success: false, error: "Only GET requests are supported." }, 405);
    }

    if (url.pathname === "/health") {
      return json({
        success: true,
        service: "skyblock-gpt-unified-gateway",
        version: "2.5.0",
        providers: ["Hypixel"],
      });
    }

    if (url.pathname === "/privacy") {
      return privacyPolicy();
    }

    if (!env.HYPIXEL_API_KEY || !env.GPT_SHARED_SECRET) {
      return json({ success: false, error: "The proxy secrets are not configured." }, 500);
    }

    const suppliedSecret = request.headers.get("X-GPT-Key") || "";
    if (!(await secretsMatch(suppliedSecret, env.GPT_SHARED_SECRET))) {
      return json({ success: false, error: "Unauthorized." }, 401);
    }

    try {
      if (url.pathname === "/v1/player/profiles") {
        return await handleProfiles(url, env);
      }

      if (url.pathname === "/v1/player/summary") {
        return await handleSummary(url, env);
      }

      if (url.pathname === "/v1/player/section") {
        return await handleSection(url, env);
      }

      if (url.pathname === "/v1/player/collections") {
        return await handlePlayerCollections(url, env);
      }

      if (url.pathname === "/v1/player/accessories") {
        return await handlePlayerAccessories(url, env);
      }

      if (url.pathname === "/v1/player/inventories") {
        return await handleInventoryIndex(url, env);
      }

      if (url.pathname === "/v1/player/inventory") {
        return await handleInventoryContainer(url, env);
      }

      if (url.pathname === "/v1/player/item") {
        return await handleInventoryItem(url, env);
      }

      if (url.pathname === "/v1/player/sacks") {
        return await handleSacks(url, env);
      }

      if (url.pathname === "/v1/player/extra") {
        return await handlePlayerExtra(url, env);
      }

      if (url.pathname === "/v1/resources") {
        return await handleResources(url, env);
      }

      if (url.pathname === "/v1/feed") {
        return await handleFeed(url, env);
      }

      if (url.pathname === "/v1/bazaar/products") {
        return await handleBazaarProducts(url, env);
      }

      if (url.pathname === "/v1/bazaar/product") {
        return await handleBazaarProduct(url, env);
      }

      if (url.pathname === "/v1/auctions/page") {
        return await handleAuctionPage(url, env);
      }

      if (url.pathname === "/v1/auctions/lowest-bin") {
        return await handleLowestBin(url, env);
      }

      if (url.pathname === "/v1/auctions/lookup") {
        return await handleAuctionLookup(url, env);
      }

      if (url.pathname === "/v1/auctions/ended") {
        return await handleEndedAuctions(url, env);
      }

      return json({ success: false, error: "Route not found." }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected proxy error.";
      const status = error instanceof ClientError || error instanceof UpstreamError ? error.status : 500;
      return json({ success: false, error: message }, status);
    }
  },
};

async function handleResources(url, env) {
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

async function handleFeed(url, env) {
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

async function handleBazaarProducts(url, env) {
  const query = readTextParameter(url, "query", 100, "").toLowerCase();
  const page = readIntegerParameter(url, "page", 0, 0, 10_000);
  const limit = readIntegerParameter(url, "limit", 25, 1, 50);
  const sort = requireEnumParameter(url, "sort", new Set([
    "product_id", "instant_buy", "instant_sell", "spread", "spread_percent", "buy_volume", "sell_volume", "moving_week",
  ]), "product_id");
  const order = requireEnumParameter(url, "order", new Set(["asc", "desc"]), "asc");
  const [payload, itemNames] = await Promise.all([
    fetchHypixelJson("/v2/skyblock/bazaar", env, {}, { authenticated: false, cacheSeconds: 15 }),
    fetchSkyBlockItemNameMap(env),
  ]);

  const products = Object.values(objectOrEmpty(payload.products))
    .map((product) => compactBazaarProduct(product, itemNames))
    .filter((product) => !query || `${product.product_id} ${product.name || ""}`.toLowerCase().includes(query));

  products.sort((left, right) => compareBazaarProducts(left, right, sort, order));

  return json({
    success: true,
    payload_kind: "bazaar_product_index",
    payload_version: "1",
    data_present: true,
    data: {
      payload_kind: "bazaar_product_index",
      payload_version: "1",
      data_present: true,
      source: "Hypixel Public API",
      source_last_updated: optionalNumber(payload.lastUpdated),
      query: query || null,
      sort,
      order,
      ...paginateRecords(products, page, limit),
    },
  });
}

async function handleBazaarProduct(url, env) {
  const requestedProduct = requireItemTag(url, "product");
  const [payload, itemNames] = await Promise.all([
    fetchHypixelJson("/v2/skyblock/bazaar", env, {}, { authenticated: false, cacheSeconds: 15 }),
    fetchSkyBlockItemNameMap(env),
  ]);
  const entries = Object.entries(objectOrEmpty(payload.products));
  const exact = entries.find(([id]) => id.toLowerCase() === requestedProduct.toLowerCase());
  const named = entries.filter(([id]) =>
    (itemNames.get(id) || "").toLowerCase() === requestedProduct.replaceAll("_", " ").toLowerCase()
  );
  const selected = exact || (named.length === 1 ? named[0] : null);
  if (!selected) {
    throw new ClientError("That Bazaar product was not found. Search the Bazaar product index for the exact product ID.", 404);
  }

  const [productId, product] = selected;
  const summary = compactBazaarProduct(product, itemNames);
  return json({
    success: true,
    payload_kind: "bazaar_product",
    payload_version: "1",
    data_present: true,
    data: {
      payload_kind: "bazaar_product",
      payload_version: "1",
      data_present: true,
      source: "Hypixel Public API",
      source_last_updated: optionalNumber(payload.lastUpdated),
      ...summary,
      sell_summary: sanitize(product.sell_summary || [], 5, 200),
      buy_summary: sanitize(product.buy_summary || [], 5, 200),
      quick_status: sanitize(product.quick_status || {}, 5, 100),
      product_id: productId,
    },
  });
}

async function handleAuctionPage(url, env) {
  const upstreamPage = readIntegerParameter(url, "upstream_page", 0, 0, 10_000);
  const resultPage = readIntegerParameter(url, "result_page", 0, 0, 10_000);
  const requestedLimit = readIntegerParameter(url, "limit", 25, 1, 50);
  const detail = readDetailParameter(url);
  const limit = detail === "full" ? Math.min(requestedLimit, 5) : requestedLimit;
  const query = readTextParameter(url, "query", 100, "").toLowerCase();
  const category = readTextParameter(url, "category", 40, "").toLowerCase();
  const tier = readTextParameter(url, "tier", 30, "").toLowerCase();
  const bin = readOptionalBooleanParameter(url, "bin");
  const sort = requireEnumParameter(
    url,
    "sort",
    new Set(["source", "ending", "price", "price_asc", "price_desc"]),
    bin === true ? "price_asc" : "source"
  );
  const payload = await fetchHypixelJson("/v2/skyblock/auctions", env, { page: upstreamPage }, {
    authenticated: false,
    cacheSeconds: 0,
  });

  let records = (Array.isArray(payload.auctions) ? payload.auctions : []).filter((auction) => {
    const matchesQuery = !query || `${auction.item_name || ""} ${auction.extra || ""} ${auction.uuid || ""}`.toLowerCase().includes(query);
    const matchesCategory = !category || String(auction.category || "").toLowerCase() === category;
    const matchesTier = !tier || String(auction.tier || "").toLowerCase() === tier;
    const matchesBin = bin === null || Boolean(auction.bin) === bin;
    return matchesQuery && matchesCategory && matchesTier && matchesBin;
  });

  if (sort === "ending") records.sort((left, right) => number(left.end) - number(right.end));
  if (sort === "price" || sort === "price_asc") records.sort((left, right) => auctionPrice(left) - auctionPrice(right));
  if (sort === "price_desc") records.sort((left, right) => auctionPrice(right) - auctionPrice(left));
  const pageLowestBinAuction = [...records]
    .filter((auction) => auction.bin === true)
    .sort((left, right) => binPrice(left) - binPrice(right))[0] || null;
  const pagination = paginateRecords(records, resultPage, limit);
  pagination.items = await Promise.all(pagination.items.map((auction) => compactAuction(auction, detail === "full")));

  return json({
    success: true,
    data: {
      source: "Hypixel Public API",
      source_last_updated: optionalNumber(payload.lastUpdated),
      upstream_page: optionalNumber(payload.page) ?? upstreamPage,
      upstream_total_pages: optionalNumber(payload.totalPages),
      upstream_total_auctions: optionalNumber(payload.totalAuctions),
      filters_apply_to_this_upstream_page: true,
      query: query || null,
      category: category || null,
      tier: tier || null,
      bin,
      sort,
      page_lowest_bin: pageLowestBinAuction
        ? {
            scope: "Filtered matches on this official upstream page only; not a global lowest BIN.",
            ...await compactAuction(pageLowestBinAuction, false),
            bin_price: binPrice(pageLowestBinAuction),
          }
        : null,
      detail,
      ...pagination,
    },
  });
}

async function handleLowestBin(url, env) {
  const requestedItem = readTextParameter(url, "item", 120, "");
  if (!requestedItem) throw new ClientError("item is required and must be an exact SkyBlock item ID or official item name.", 400);
  const startPage = readIntegerParameter(url, "start_page", 0, 0, 10_000);
  const maxPages = readIntegerParameter(url, "max_pages", 4, 1, 4);
  const limit = readIntegerParameter(url, "limit", 10, 1, 25);
  const category = readTextParameter(url, "category", 40, "").toLowerCase();
  const tier = readTextParameter(url, "tier", 30, "").toLowerCase();
  const expectedLastUpdated = url.searchParams.has("expected_last_updated")
    ? readIntegerParameter(url, "expected_last_updated", null, 0, Number.MAX_SAFE_INTEGER)
    : null;

  const [itemNames, firstPayload] = await Promise.all([
    fetchSkyBlockItemNameMap(env),
    fetchHypixelJson("/v2/skyblock/auctions", env, { page: startPage }, {
      authenticated: false,
      cacheSeconds: 0,
    }),
  ]);
  const target = resolveSkyBlockItem(itemNames, requestedItem);
  if (!target) {
    throw new ClientError("That item was not found in Hypixel's current SkyBlock item resource. Use its exact item ID or official name.", 404);
  }
  if (target.ambiguous_ids) {
    throw new ClientError(`That item name is ambiguous. Use one of these exact IDs: ${target.ambiguous_ids.join(", ")}.`, 400);
  }

  const totalPages = optionalNumber(firstPayload.totalPages);
  const snapshotLastUpdated = optionalNumber(firstPayload.lastUpdated);
  if (totalPages === null || totalPages < 1) throw new UpstreamError("Hypixel did not return a valid active-auction page count.", 502);
  if (expectedLastUpdated !== null && snapshotLastUpdated !== expectedLastUpdated) {
    throw new ClientError("The Auction House snapshot changed between scan segments. Restart at start_page=0.", 409);
  }

  const endPageExclusive = Math.min(totalPages, startPage + maxPages);
  const remainingPages = [];
  for (let page = startPage + 1; page < endPageExclusive; page += 1) remainingPages.push(page);
  const nameNeedle = normalizeItemSearchText(target.name);
  const maximumCandidateDecodes = 100;
  const candidates = [];
  let candidateCount = 0;
  let pagesScanned = 0;
  let snapshotConsistent = snapshotLastUpdated !== null;
  const collectCandidates = (payload) => {
    pagesScanned += 1;
    if (optionalNumber(payload.lastUpdated) !== snapshotLastUpdated) snapshotConsistent = false;
    for (const auction of Array.isArray(payload.auctions) ? payload.auctions : []) {
      if (auction.bin !== true) continue;
      if (category && String(auction.category || "").toLowerCase() !== category) continue;
      if (tier && String(auction.tier || "").toLowerCase() !== tier) continue;
      const searchableName = normalizeItemSearchText(`${auction.item_name || ""} ${auction.extra || ""}`);
      if (!searchableName.includes(nameNeedle)) continue;
      candidateCount += 1;
      if (candidates.length < maximumCandidateDecodes) candidates.push(auction);
    }
  };
  collectCandidates(firstPayload);
  for (let index = 0; index < remainingPages.length; index += 1) {
    const pageBatch = remainingPages.slice(index, index + 1);
    const payloadBatch = await Promise.all(pageBatch.map((page) =>
      fetchHypixelJson("/v2/skyblock/auctions", env, { page }, {
        authenticated: false,
        cacheSeconds: 0,
      })
    ));
    for (const payload of payloadBatch) collectCandidates(payload);
  }

  const candidateDecodeTruncated = candidateCount > maximumCandidateDecodes;
  let decodeFailures = 0;
  const matches = [];
  // Decode small batches and immediately discard raw NBT trees. Keeping hundreds of
  // decoded auction blobs alive at once can exceed Cloudflare Worker's memory limit.
  for (let index = 0; index < candidates.length; index += 5) {
    const decodedBatch = await Promise.all(candidates.slice(index, index + 5).map(async (auction) => {
      const decoded = await decodeInventoryBlob(auction.item_bytes);
      return {
        auction,
        error: decoded.error,
        item: decoded.records[0]?.summary || null,
      };
    }));
    for (const candidate of decodedBatch) {
      if (candidate.error || !candidate.item?.skyblock_id) {
        decodeFailures += 1;
        continue;
      }
      if (!skyBlockItemIdsMatch(candidate.item.skyblock_id, target.id)) continue;
      matches.push({ auction: candidate.auction, item: candidate.item });
    }
  }
  matches.sort((left, right) => binPrice(left.auction) - binPrice(right.auction));

  const cheapestMatches = await Promise.all(matches.slice(0, limit).map(async ({ auction, item }) => ({
    ...await compactAuction(auction, false),
    bin_price: binPrice(auction),
    verified_item: item,
  })));
  const segmentLowestBin = cheapestMatches[0] || null;
  const coversAllPages = startPage === 0 && endPageExclusive >= totalPages;
  const complete = coversAllPages && snapshotConsistent && !candidateDecodeTruncated && decodeFailures === 0;

  return json({
    success: true,
    data: {
      source: "Hypixel Public API",
      target: {
        requested: requestedItem,
        item_id: target.id,
        name: target.name,
      },
      filters: {
        bin_only: true,
        category: category || null,
        tier: tier || null,
      },
      scan: {
        snapshot_last_updated: snapshotLastUpdated,
        snapshot_consistent: snapshotConsistent,
        expected_last_updated: expectedLastUpdated,
        total_upstream_pages: totalPages,
        start_page: startPage,
        pages_scanned: pagesScanned,
        scanned_through_page: endPageExclusive - 1,
        next_start_page: endPageExclusive < totalPages ? endPageExclusive : null,
        covers_all_pages: coversAllPages,
        complete,
        name_prefilter_candidates: candidateCount,
        candidate_decode_truncated: candidateDecodeTruncated,
        decode_failures: decodeFailures,
      },
      match_count_in_segment: matches.length,
      price_order: "ascending",
      segment_lowest_bin: segmentLowestBin,
      authoritative_lowest_bin: complete ? segmentLowestBin : null,
      auctions: cheapestMatches,
      warning: complete
        ? null
        : "This scan is not yet authoritative. Continue from next_start_page using the same expected_last_updated, or restart if the snapshot changed.",
    },
  });
}

async function handleAuctionLookup(url, env) {
  const queryNames = ["uuid", "player", "profile"];
  const supplied = queryNames
    .map((name) => [name, readTextParameter(url, name, 64, "")])
    .filter(([, value]) => value);
  if (supplied.length !== 1) {
    throw new ClientError("Provide exactly one auction lookup: uuid, player, or profile.", 400);
  }
  const [lookupType, lookupValue] = supplied[0];
  if (!GENERIC_UUID_PATTERN.test(lookupValue)) {
    throw new ClientError(`${lookupType} must be a valid dashed or undashed UUID.`, 400);
  }
  const page = readIntegerParameter(url, "page", 0, 0, 10_000);
  const requestedLimit = readIntegerParameter(url, "limit", lookupType === "uuid" ? 1 : 20, 1, 50);
  const requestedDetail = (url.searchParams.get("detail") || (lookupType === "uuid" ? "full" : "summary")).toLowerCase();
  if (!new Set(["summary", "full"]).has(requestedDetail)) throw new ClientError("detail must be summary or full.", 400);
  const limit = requestedDetail === "full" ? Math.min(requestedLimit, 5) : requestedLimit;
  const payload = await fetchHypixelJson("/v2/skyblock/auction", env, { [lookupType]: normalizeUuid(lookupValue) }, {
    authenticated: true,
    cacheSeconds: 20,
  });
  const records = Array.isArray(payload.auctions) ? payload.auctions : [];
  const pagination = paginateRecords(records, page, limit);
  pagination.items = await Promise.all(pagination.items.map((auction) => compactAuction(auction, requestedDetail === "full")));

  return json({
    success: true,
    data: {
      source: "Hypixel Public API",
      lookup_type: lookupType,
      lookup_value: normalizeUuid(lookupValue),
      detail: requestedDetail,
      ...pagination,
    },
  });
}

async function handleEndedAuctions(url, env) {
  const query = readTextParameter(url, "query", 100, "").toLowerCase();
  const page = readIntegerParameter(url, "page", 0, 0, 10_000);
  const requestedLimit = readIntegerParameter(url, "limit", 25, 1, 50);
  const detail = readDetailParameter(url);
  const limit = detail === "full" ? Math.min(requestedLimit, 5) : requestedLimit;
  const payload = await fetchHypixelJson("/v2/skyblock/auctions_ended", env, {}, {
    authenticated: false,
    cacheSeconds: 20,
  });
  const records = (Array.isArray(payload.auctions) ? payload.auctions : [])
    .filter((auction) => !query || `${auction.auction_id || ""} ${auction.seller || ""}`.toLowerCase().includes(query));
  const pagination = paginateRecords(records, page, limit);
  pagination.items = await Promise.all(pagination.items.map((auction) => compactEndedAuction(auction, detail === "full")));

  return json({
    success: true,
    data: {
      source: "Hypixel Public API",
      source_last_updated: optionalNumber(payload.lastUpdated),
      coverage: "Auctions ended during Hypixel's recent-ended window, normally about 60 seconds.",
      query: query || null,
      detail,
      ...pagination,
    },
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

async function secretsMatch(left, right) {
  if (!left || !right) return false;
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let i = 0; i < leftBytes.length; i += 1) difference |= leftBytes[i] ^ rightBytes[i];
  return difference === 0;
}
