import {
  number,
  objectOrEmpty,
  optionalNumber,
  paginateRecords,
  sanitize,
} from "../util.js";
import { ClientError, json, UpstreamError } from "../http.js";
import {
  GENERIC_UUID_PATTERN,
  normalizeUuid,
  readDetailParameter,
  readIntegerParameter,
  readOptionalBooleanParameter,
  readTextParameter,
  requireEnumParameter,
  requireItemTag,
} from "../params.js";
import { fetchHypixelJson, fetchSkyBlockItemNameMap } from "../hypixel.js";
import { decodeInventoryBlob } from "../items.js";
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
} from "../market.js";

export async function handleBazaarProducts(url, env) {
  const query = readTextParameter(url, "query", 100, "").toLowerCase();
  const page = readIntegerParameter(url, "page", 0, 0, 10_000);
  const limit = readIntegerParameter(url, "limit", 25, 1, 50);
  const sort = requireEnumParameter(url, "sort", new Set([
    "product_id", "instant_buy", "instant_sell", "spread", "spread_percent", "buy_volume", "sell_volume", "moving_week",
  ]), "product_id");
  const order = requireEnumParameter(url, "order", new Set(["asc", "desc"]), "asc");
  const [payload, itemNames] = await Promise.all([
    fetchHypixelJson("/v2/skyblock/bazaar", env, {}, { authenticated: false }),
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

export async function handleBazaarProduct(url, env) {
  const requestedProduct = requireItemTag(url, "product");
  const [payload, itemNames] = await Promise.all([
    fetchHypixelJson("/v2/skyblock/bazaar", env, {}, { authenticated: false }),
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

export async function handleAuctionPage(url, env) {
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
  });

  let records = (Array.isArray(payload.auctions) ? payload.auctions : []).filter((auction) => {
    const matchesQuery = !query || `${auction.item_name || ""} ${auction.extra || ""} ${auction.uuid || ""}`.toLowerCase().includes(query);
    const matchesCategory = !category || String(auction.category || "").toLowerCase() === category;
    const matchesTier = !tier || String(auction.tier || "").toLowerCase() === tier;
    const matchesBin = bin === null || Boolean(auction.bin) === bin;
    return matchesQuery && matchesCategory && matchesTier && matchesBin;
  });

  if (sort === "ending") {
    records.sort((left, right) => number(left.end) - number(right.end));
  } else if (sort === "price" || sort === "price_asc" || sort === "price_desc") {
    const priceOf = new Map(records.map((auction) => [auction, auctionPrice(auction)]));
    records.sort((left, right) => sort === "price_desc"
      ? priceOf.get(right) - priceOf.get(left)
      : priceOf.get(left) - priceOf.get(right));
  }
  const binRecords = records.filter((auction) => auction.bin === true);
  const binPriceOf = new Map(binRecords.map((auction) => [auction, binPrice(auction)]));
  const pageLowestBinAuction = [...binRecords]
    .sort((left, right) => binPriceOf.get(left) - binPriceOf.get(right))[0] || null;
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

export async function handleLowestBin(url, env) {
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
  const decodeBudget = 60;
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
      candidates.push(auction);
    }
  };
  collectCandidates(firstPayload);
  const remainingPayloads = await Promise.all(remainingPages.map((page) =>
    fetchHypixelJson("/v2/skyblock/auctions", env, { page }, { authenticated: false })
  ));
  for (const payload of remainingPayloads) collectCandidates(payload);

  // Price is a plain JSON field, so sort before decoding and decode only from
  // the cheapest upward. The route answers "what is cheapest", so it can stop
  // as soon as it has `limit` confirmed matches. This is ~10-20 decodes rather
  // than every candidate, and each decode is base64 + gzip + a full NBT walk.
  candidates.sort((left, right) => binPrice(left) - binPrice(right));

  let decodesPerformed = 0;
  let decodeFailures = 0;
  const matches = [];
  for (const auction of candidates) {
    if (matches.length >= limit) break;
    if (decodesPerformed >= decodeBudget) break;
    decodesPerformed += 1;
    const decoded = await decodeInventoryBlob(auction.item_bytes);
    const item = decoded.records[0]?.summary || null;
    if (decoded.error || !item?.skyblock_id) {
      decodeFailures += 1;
      continue;
    }
    if (!skyBlockItemIdsMatch(item.skyblock_id, target.id)) continue;
    matches.push({ auction, item });
  }
  // Candidates were sorted ascending and walked in order, so matches already are.
  // The budget only ran out if there were candidates we never got to — landing
  // exactly on decodeBudget after draining every candidate is not exhaustion.
  const decodeBudgetExhausted = decodesPerformed >= decodeBudget
    && decodesPerformed < candidates.length
    && matches.length < limit;

  const cheapestMatches = await Promise.all(matches.slice(0, limit).map(async ({ auction, item }) => ({
    ...await compactAuction(auction, false),
    bin_price: binPrice(auction),
    verified_item: item,
  })));
  const segmentLowestBin = cheapestMatches[0] || null;
  const coversAllPages = startPage === 0 && endPageExclusive >= totalPages;
  const complete = coversAllPages && snapshotConsistent && !decodeBudgetExhausted && decodeFailures === 0;

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
        segments_required: Math.ceil(totalPages / maxPages),
        segment_index: Math.floor(startPage / maxPages),
        covers_all_pages: coversAllPages,
        complete,
        name_prefilter_candidates: candidateCount,
        decodes_performed: decodesPerformed,
        decode_budget: decodeBudget,
        decode_budget_exhausted: decodeBudgetExhausted,
        decode_failures: decodeFailures,
      },
      match_count_in_segment: matches.length,
      match_count_is_lower_bound: true,
      price_order: "ascending",
      segment_lowest_bin: segmentLowestBin,
      authoritative_lowest_bin: complete ? segmentLowestBin : null,
      auctions: cheapestMatches,
      warning: complete
        ? null
        : "This scan is not yet authoritative. Continue from next_start_page using the same expected_last_updated, keeping the lowest segment_lowest_bin seen so far, or restart if the snapshot changed.",
    },
  });
}

export async function handleAuctionLookup(url, env) {
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

export async function handleEndedAuctions(url, env) {
  const query = readTextParameter(url, "query", 100, "").toLowerCase();
  const page = readIntegerParameter(url, "page", 0, 0, 10_000);
  const requestedLimit = readIntegerParameter(url, "limit", 25, 1, 50);
  const detail = readDetailParameter(url);
  const limit = detail === "full" ? Math.min(requestedLimit, 5) : requestedLimit;
  const payload = await fetchHypixelJson("/v2/skyblock/auctions_ended", env, {}, {
    authenticated: false,
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
