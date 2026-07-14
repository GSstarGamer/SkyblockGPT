import {
  firstNumber,
  isoFromUnixMs,
  normalizeUnixMilliseconds,
  number,
  objectOrEmpty,
  optionalNumber,
  paginateRecords,
  pick,
  round,
  sanitize,
  stringOrNull,
} from "./util.js";
import { ClientError, json, privacyPolicy, UpstreamError } from "./http.js";
import { decodeBase64, decompressGzip, NbtReader } from "./nbt.js";
import {
  cleanSelector,
  GENERIC_UUID_PATTERN,
  normalizeUuid,
  readDetailParameter,
  readIntegerParameter,
  readOptionalBooleanParameter,
  readTextParameter,
  requireContainerId,
  requireEnumParameter,
  requireItemTag,
  requireUuid,
} from "./params.js";

const RESOURCE_KINDS = new Set(["collections", "skills", "items", "election", "bingo"]);
const FEED_KINDS = new Set(["news", "firesales"]);
const EXTRA_KINDS = new Set(["museum", "garden", "bingo"]);
const UPSTREAM_USER_AGENT = "SkyblockGPT/2.5.0 (contact: Discord gs._)";
const memoryCache = new Map();
const PROFILE_SECTIONS = new Set([
  "overview",
  "skills",
  "slayers",
  "dungeons",
  "collections",
  "mining",
  "forge",
  "foraging",
  "stats",
  "gear",
  "pets",
  "accessories",
  "bestiary",
  "rift",
]);

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

async function handleProfiles(url, env) {
  const uuid = requireUuid(url);
  const profiles = await fetchProfiles(uuid, env);

  return json({
    success: true,
    uuid,
    profiles: profiles.map((profile) => compactProfile(profile, uuid)),
  });
}

async function handleSummary(url, env) {
  const uuid = requireUuid(url);
  const selector = cleanSelector(url.searchParams.get("profile"));
  const [profiles, skillResource] = await Promise.all([
    fetchProfiles(uuid, env),
    fetchSkillResource(env),
  ]);
  const profile = selectProfile(profiles, uuid, selector);
  const member = getMember(profile, uuid);

  if (!member) {
    return json({ success: false, error: "The player is not a member of that profile." }, 404);
  }

  return json({
    success: true,
    uuid,
    profile: compactProfile(profile, uuid),
    data: buildOverview(profile, member, skillResource),
  });
}

async function handleSection(url, env) {
  const uuid = requireUuid(url);
  const selector = cleanSelector(url.searchParams.get("profile"));
  const section = (url.searchParams.get("section") || "").toLowerCase();

  if (!PROFILE_SECTIONS.has(section)) {
    return json({
      success: false,
      error: `Unsupported section. Use one of: ${[...PROFILE_SECTIONS].join(", ")}.`,
    }, 400);
  }

  const [profiles, skillResource] = await Promise.all([
    fetchProfiles(uuid, env),
    section === "skills" || section === "stats" ? fetchSkillResource(env) : Promise.resolve(null),
  ]);
  const profile = selectProfile(profiles, uuid, selector);
  const member = getMember(profile, uuid);

  if (!member) {
    return json({ success: false, error: "The player is not a member of that profile." }, 404);
  }

  return json({
    success: true,
    uuid,
    profile: compactProfile(profile, uuid),
    section,
    payload_kind: `profile_section_${section}`,
    payload_version: "1",
    data_present: true,
    data: await buildSection(section, profile, member, skillResource),
  });
}

async function handlePlayerCollections(url, env) {
  const query = readTextParameter(url, "query", 100, "").toLowerCase();
  const page = readIntegerParameter(url, "page", 0, 0, 10_000);
  const limit = readIntegerParameter(url, "limit", 50, 1, 100);
  const includeUnlocks = readOptionalBooleanParameter(url, "include_unlocks") === true;
  const [{ uuid, profile, member }, collectionResource] = await Promise.all([
    loadSelectedMember(url, env),
    fetchCollectionResource(env),
  ]);
  const data = compactPlayerCollections(member, collectionResource, query, page, limit, includeUnlocks);

  return json({
    success: true,
    uuid,
    profile: compactProfile(profile, uuid),
    payload_kind: "player_collections",
    payload_version: "1",
    data_present: data.collection_api_present,
    data,
  });
}

async function handlePlayerAccessories(url, env) {
  const query = readTextParameter(url, "query", 100, "").toLowerCase();
  const page = readIntegerParameter(url, "page", 0, 0, 10_000);
  const limit = readIntegerParameter(url, "limit", 50, 1, 100);
  const { uuid, profile, member } = await loadSelectedMember(url, env);
  const compact = await compactAccessories(member);
  const allAccessories = Array.isArray(compact.accessories) ? compact.accessories : [];
  const bagSettings = objectOrEmpty(compact.bag_settings);
  const matchingAccessories = allAccessories.filter((item) =>
    !query || `${item.skyblock_id || ""} ${item.name || ""}`.toLowerCase().includes(query)
  );
  const counts = new Map();
  for (const item of allAccessories) {
    const id = item.skyblock_id || item.name || "UNKNOWN";
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const duplicateItems = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([itemId, count]) => ({ item_id: itemId, count }))
    .sort((left, right) => right.count - left.count || left.item_id.localeCompare(right.item_id));
  const pagination = paginateRecords(matchingAccessories, page, limit);

  return json({
    success: true,
    uuid,
    profile: compactProfile(profile, uuid),
    payload_kind: "player_accessories",
    payload_version: "1",
    data_present: compact.accessory_bag_api_present === true,
    data: {
      payload_kind: "player_accessories",
      payload_version: "1",
      data_present: compact.accessory_bag_api_present === true,
      available: compact.available === true,
      accessory_bag_api_present: compact.accessory_bag_api_present === true,
      container: compact.container || null,
      highest_magical_power: firstNumber(
        bagSettings.highest_magical_power,
        bagSettings.highestMagicalPower
      ),
      reported_magical_power: firstNumber(
        bagSettings.magical_power,
        bagSettings.current_magical_power,
        bagSettings.magicalPower
      ),
      selected_power: stringOrNull(
        bagSettings.selected_power ?? bagSettings.selectedPower
      ),
      tuning: sanitize(bagSettings.tuning || {}, 5, 200),
      bag_settings: bagSettings,
      total_accessories: allAccessories.length,
      unique_item_ids: counts.size,
      duplicate_items: duplicateItems,
      query: query || null,
      page: pagination.page,
      limit: pagination.limit,
      total_items: pagination.total_items,
      total_pages: pagination.total_pages,
      has_more: pagination.has_more,
      accessories: pagination.items,
      reason: compact.reason || null,
      decode_error: compact.decode_error || null,
    },
  });
}

async function handleInventoryIndex(url, env) {
  const { uuid, profile, member } = await loadSelectedMember(url, env);
  const containers = findNbtContainers(member);
  const sacksCounts = findSacksCounts(member);
  const nonzeroSackCounts = sacksCounts
    ? Object.values(sacksCounts).map(optionalNumber).filter((value) => value !== null && value > 0)
    : [];

  return json({
    success: true,
    uuid,
    profile: compactProfile(profile, uuid),
    data: {
      available: containers.length > 0,
      total_containers: containers.length,
      containers: containers.map(containerMetadata),
      sacks: {
        available: sacksCounts !== null,
        nonzero_item_types: nonzeroSackCounts.length,
        total_item_quantity: nonzeroSackCounts.reduce((sum, value) => sum + value, 0),
        operation: "getCompactSkyBlockSacks",
        reason: sacksCounts !== null
          ? null
          : "Hypixel did not include sacks_counts. The player's Inventory API setting may be disabled.",
      },
      reason: containers.length
        ? null
        : "Hypixel did not include any compressed inventory containers. The player's Inventory API setting may be disabled.",
    },
  });
}

async function handleInventoryContainer(url, env) {
  const { uuid, profile, member } = await loadSelectedMember(url, env);
  const containerId = requireContainerId(url);
  const container = findNbtContainers(member).find((entry) => entry.id === containerId);

  if (!container) {
    throw new ClientError("That inventory container was not found. Request the inventory index again for valid container IDs.", 404);
  }

  const page = readIntegerParameter(url, "page", 0, 0, 10_000);
  const requestedLimit = readIntegerParameter(url, "limit", 25, 1, 50);
  const detail = (url.searchParams.get("detail") || "summary").toLowerCase();
  if (!new Set(["summary", "full"]).has(detail)) {
    throw new ClientError("detail must be summary or full.", 400);
  }

  const limit = detail === "full" ? Math.min(requestedLimit, 5) : requestedLimit;
  const decoded = await decodeInventoryBlob(container.blob);
  if (decoded.error) {
    throw new UpstreamError(`The ${container.label} data was present but could not be decoded: ${decoded.error}`, 502);
  }

  const records = decoded.records.sort((left, right) => number(left.summary.slot) - number(right.summary.slot));
  const start = page * limit;
  const pageRecords = records.slice(start, start + limit);

  return json({
    success: true,
    uuid,
    profile: compactProfile(profile, uuid),
    data: {
      container: containerMetadata(container),
      detail,
      page,
      limit,
      requested_limit: requestedLimit,
      total_items: records.length,
      total_pages: Math.ceil(records.length / limit),
      has_more: start + limit < records.length,
      items: pageRecords.map((record) => detail === "full" ? expandNbtItem(record) : record.summary),
    },
  });
}

async function handleInventoryItem(url, env) {
  const { uuid, profile, member } = await loadSelectedMember(url, env);
  const containerId = requireContainerId(url);
  const slot = readIntegerParameter(url, "slot", null, 0, 100_000);
  const container = findNbtContainers(member).find((entry) => entry.id === containerId);

  if (!container) {
    throw new ClientError("That inventory container was not found. Request the inventory index again for valid container IDs.", 404);
  }

  const decoded = await decodeInventoryBlob(container.blob);
  if (decoded.error) {
    throw new UpstreamError(`The ${container.label} data was present but could not be decoded: ${decoded.error}`, 502);
  }

  const record = decoded.records.find((entry) => entry.summary.slot === slot);
  if (!record) {
    throw new ClientError(`No item was found in slot ${slot} of ${container.label}.`, 404);
  }

  return json({
    success: true,
    uuid,
    profile: compactProfile(profile, uuid),
    data: {
      container: containerMetadata(container),
      item: expandNbtItem(record),
    },
  });
}

async function handleSacks(url, env) {
  const { uuid, profile, member } = await loadSelectedMember(url, env);
  const query = readTextParameter(url, "query", 100, "").toLowerCase();
  const page = readIntegerParameter(url, "page", 0, 0, 10_000);
  const limit = readIntegerParameter(url, "limit", 50, 1, 100);
  const sort = requireEnumParameter(url, "sort", new Set(["quantity", "item_id", "name"]), "quantity");
  const order = requireEnumParameter(url, "order", new Set(["asc", "desc"]), "desc");
  const sacksCounts = findSacksCounts(member);

  if (!sacksCounts) {
    return json({
      success: true,
      uuid,
      profile: compactProfile(profile, uuid),
      payload_kind: "player_sacks",
      payload_version: "1",
      data_present: false,
      data: {
        payload_kind: "player_sacks",
        payload_version: "1",
        data_present: false,
        available: false,
        sacks_api_present: false,
        query: query || null,
        sort,
        order,
        total_distinct_items: 0,
        total_item_quantity: 0,
        page,
        limit,
        total_items: 0,
        total_pages: 0,
        has_more: false,
        items: [],
        reason: "Hypixel did not include sacks_counts. The player's Inventory API setting may be disabled.",
      },
    });
  }

  const itemNames = await fetchSkyBlockItemNameMap(env);
  const allItems = Object.entries(sacksCounts)
    .map(([itemId, rawQuantity]) => ({
      item_id: itemId,
      name: cleanItemName(itemNames.get(itemId)) || formatItemId(itemId),
      quantity: optionalNumber(rawQuantity),
    }))
    .filter((item) => item.quantity !== null && item.quantity > 0);
  const totalItemQuantity = allItems.reduce((sum, item) => sum + item.quantity, 0);
  const items = allItems.filter((item) => !query || `${item.item_id} ${item.name || ""}`.toLowerCase().includes(query));
  items.sort((left, right) => compareSackItems(left, right, sort, order));

  return json({
    success: true,
    uuid,
    profile: compactProfile(profile, uuid),
    payload_kind: "player_sacks",
    payload_version: "1",
    data_present: true,
    data: {
      payload_kind: "player_sacks",
      payload_version: "1",
      data_present: true,
      available: true,
      sacks_api_present: true,
      query: query || null,
      sort,
      order,
      total_distinct_items: allItems.length,
      total_item_quantity: totalItemQuantity,
      ...paginateRecords(items, page, limit),
      reason: null,
    },
  });
}

async function handlePlayerExtra(url, env) {
  const uuid = requireUuid(url);
  const kind = requireEnumParameter(url, "kind", EXTRA_KINDS);

  if (kind === "bingo") {
    const payload = await fetchHypixelJson("/v2/skyblock/bingo", env, { uuid }, {
      authenticated: true,
      cacheSeconds: 60,
    });
    return json({
      success: true,
      uuid,
      kind,
      data: {
        total_events: Array.isArray(payload.events) ? payload.events.length : 0,
        events: sanitize(payload.events || [], 7, 500),
      },
    });
  }

  const selector = cleanSelector(url.searchParams.get("profile"));
  const profiles = await fetchProfiles(uuid, env);
  const selectedProfile = selectProfile(profiles, uuid, selector);
  const profileId = normalizeUuid(selectedProfile.profile_id || "");
  if (!GENERIC_UUID_PATTERN.test(profileId)) {
    throw new ClientError("The selected SkyBlock profile did not contain a valid profile ID.", 502);
  }

  if (kind === "garden") {
    const payload = await fetchHypixelJson("/v2/skyblock/garden", env, { profile: profileId }, {
      authenticated: true,
      cacheSeconds: 60,
    });
    return json({
      success: true,
      uuid,
      profile: compactProfile(selectedProfile, uuid),
      kind,
      data: compactGarden(payload.garden || {}),
    });
  }

  const payload = await fetchHypixelJson("/v2/skyblock/museum", env, { profile: profileId }, {
    authenticated: true,
    cacheSeconds: 60,
  });
  const query = readTextParameter(url, "query", 100, "").toLowerCase();
  const page = readIntegerParameter(url, "page", 0, 0, 10_000);
  const limit = readIntegerParameter(url, "limit", 20, 1, 40);
  const museum = compactMuseum(payload.profile || {}, query, page, limit);

  return json({
    success: true,
    uuid,
    profile: compactProfile(selectedProfile, uuid),
    kind,
    data: museum,
  });
}

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

function compactGarden(garden) {
  const value = objectOrEmpty(garden);
  return sanitize({
    uuid: value.uuid || null,
    garden_experience: value.garden_experience,
    commission_data: value.commission_data,
    composter_data: value.composter_data,
    active_commissions: value.active_commissions,
    resources_collected: value.resources_collected,
    crop_upgrade_levels: value.crop_upgrade_levels,
    unlocked_plots_ids: value.unlocked_plots_ids,
    unlocked_barn_skins: value.unlocked_barn_skins,
    selected_barn_skin: value.selected_barn_skin,
    additional_fields: Object.fromEntries(Object.entries(value).filter(([key]) => !new Set([
      "uuid", "garden_experience", "commission_data", "composter_data", "active_commissions", "resources_collected",
      "crop_upgrade_levels", "unlocked_plots_ids", "unlocked_barn_skins", "selected_barn_skin",
    ]).has(key))),
  }, 10, 2_000);
}

function compactMuseum(profileData, query, page, limit) {
  const members = [];
  const entries = [];
  for (const [memberUuid, rawMuseum] of Object.entries(objectOrEmpty(profileData))) {
    const museum = objectOrEmpty(rawMuseum);
    const memberEntries = [];
    for (const [itemId, itemData] of Object.entries(objectOrEmpty(museum.items))) {
      memberEntries.push({
        member_uuid: normalizeUuid(memberUuid),
        source: "items",
        item_id: itemId,
        data: sanitize(itemData, 7, 400),
      });
    }
    for (const [index, special] of (Array.isArray(museum.special) ? museum.special : []).entries()) {
      const specialItems = objectOrEmpty(special?.items);
      if (Object.keys(specialItems).length) {
        for (const [itemId, itemData] of Object.entries(specialItems)) {
          memberEntries.push({
            member_uuid: normalizeUuid(memberUuid),
            source: "special",
            special_index: index,
            donated_time: optionalNumber(special?.donated_time),
            item_id: itemId,
            data: sanitize(itemData, 7, 400),
          });
        }
      } else {
        memberEntries.push({
          member_uuid: normalizeUuid(memberUuid),
          source: "special",
          special_index: index,
          data: sanitize(special, 7, 400),
        });
      }
    }
    members.push({
      member_uuid: normalizeUuid(memberUuid),
      value: optionalNumber(museum.value),
      appraisal: museum.appraisal ?? null,
      total_entries: memberEntries.length,
    });
    entries.push(...memberEntries);
  }

  const filtered = entries.filter((entry) => !query || JSON.stringify(entry).toLowerCase().includes(query));
  return {
    members,
    query: query || null,
    ...paginateRecords(filtered, page, limit),
  };
}

function flattenCollections(collections) {
  const output = [];
  for (const [categoryId, categoryValue] of Object.entries(objectOrEmpty(collections))) {
    const category = objectOrEmpty(categoryValue);
    const items = objectOrEmpty(category.items);
    if (!Object.keys(items).length) {
      output.push({ category_id: categoryId, id: categoryId, ...category });
      continue;
    }
    for (const [itemId, itemValue] of Object.entries(items)) {
      output.push({
        category_id: categoryId,
        category_name: category.name || null,
        id: itemId,
        ...objectOrEmpty(itemValue),
      });
    }
  }
  return output;
}

function compactResourceItem(item) {
  return sanitize(pick(item, [
    "id", "name", "material", "category", "tier", "npc_sell_price", "color", "stats", "soulbound", "museum", "generator", "furniture", "glowing",
  ]), 6, 200);
}

function compactCollectionItem(item) {
  return sanitize(pick(item, [
    "category_id", "category_name", "id", "name", "maxTiers", "tiers", "bossCollection", "mobs",
  ]), 7, 300);
}

function compactPlayerCollections(member, resource, query, page, limit, includeUnlocks = false) {
  const rawCandidate = member?.collection ?? member?.player_data?.collection;
  const collectionApiPresent = Boolean(
    rawCandidate && typeof rawCandidate === "object" && !Array.isArray(rawCandidate)
  );
  const rawCollections = collectionApiPresent ? rawCandidate : {};
  const resourceRecords = resource ? flattenCollections(resource.collections || {}) : [];
  const resourceById = new Map(resourceRecords.map((record) => [String(record.id || "").toUpperCase(), record]));

  const allCollections = Object.entries(rawCollections)
    .map(([collectionId, rawAmount]) => {
      const amount = optionalNumber(rawAmount);
      if (amount === null) return null;
      const metadata = resourceById.get(collectionId.toUpperCase()) || null;
      const tiers = Array.isArray(metadata?.tiers)
        ? metadata.tiers
            .map((tier, index) => compactCollectionTier(tier, index))
            .filter(Boolean)
            .sort((left, right) => left.tier - right.tier)
        : [];
      const achieved = tiers.filter((tier) => tier.amount_required !== null && amount >= tier.amount_required).at(-1) || null;
      const next = tiers.find((tier) => tier.amount_required !== null && amount < tier.amount_required) || null;
      const unlockedRewards = includeUnlocks
        ? [...new Set(tiers
            .filter((tier) => tier.amount_required !== null && amount >= tier.amount_required)
            .flatMap((tier) => tier.unlocks)
          )].slice(0, 200)
        : [];

      return {
        collection_id: collectionId,
        name: cleanItemName(metadata?.name) || formatItemId(collectionId),
        category_id: metadata?.category_id || null,
        category_name: cleanItemName(metadata?.category_name) || null,
        amount,
        achieved_tier: achieved?.tier ?? (tiers.length ? 0 : null),
        max_tier: optionalNumber(metadata?.maxTiers) ?? (tiers.length ? tiers.at(-1).tier : null),
        next_tier: next?.tier ?? null,
        next_tier_requirement: next?.amount_required ?? null,
        amount_to_next_tier: next?.amount_required === null || next?.amount_required === undefined
          ? null
          : Math.max(0, next.amount_required - amount),
        unlocked_rewards: unlockedRewards,
        next_tier_unlocks: includeUnlocks && next ? next.unlocks : [],
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.collection_id.localeCompare(right.collection_id));
  const matchingCollections = allCollections.filter((entry) =>
    !query || `${entry.collection_id} ${entry.name || ""} ${entry.category_name || ""}`.toLowerCase().includes(query)
  );
  const pagination = paginateRecords(matchingCollections, page, limit);

  return {
    payload_kind: "player_collections",
    payload_version: "1",
    data_present: collectionApiPresent,
    available: collectionApiPresent,
    collection_api_present: collectionApiPresent,
    resource_metadata_available: resourceRecords.length > 0,
    source_last_updated: optionalNumber(resource?.lastUpdated),
    source_version: stringOrNull(resource?.version),
    unlocks_included: includeUnlocks,
    query: query || null,
    total_distinct_collections: allCollections.length,
    total_collected: allCollections.reduce((sum, entry) => sum + entry.amount, 0),
    page: pagination.page,
    limit: pagination.limit,
    total_items: pagination.total_items,
    total_pages: pagination.total_pages,
    has_more: pagination.has_more,
    collections: pagination.items,
    reason: collectionApiPresent
      ? null
      : "Hypixel did not expose player collection amounts for this profile. The player's Collection API setting may be disabled.",
  };
}

function compactCollectionTier(tier, index) {
  if (!tier || typeof tier !== "object") return null;
  const tierNumber = optionalNumber(tier.tier ?? tier.level) ?? index + 1;
  const amountRequired = optionalNumber(
    tier.amountRequired ?? tier.amount_required ?? tier.requiredAmount ?? tier.required_amount
  );
  const rawUnlocks = Array.isArray(tier.unlocks) ? tier.unlocks : [];
  const unlocks = rawUnlocks
    .map((unlock) => collectionUnlockText(unlock))
    .filter(Boolean)
    .slice(0, 100);
  return { tier: tierNumber, amount_required: amountRequired, unlocks };
}

function collectionUnlockText(unlock) {
  if (typeof unlock === "string") return cleanItemName(unlock);
  if (unlock === null || unlock === undefined) return null;
  try {
    return JSON.stringify(sanitize(unlock, 4, 50)).slice(0, 500);
  } catch {
    return String(unlock).slice(0, 500);
  }
}

function resourceRecordMatches(record, query) {
  if (!query) return true;
  const id = String(record?.id || "").toLowerCase();
  const name = String(record?.name || "").toLowerCase();
  return id.includes(query) || name.includes(query);
}

function compactBazaarProduct(product, itemNames) {
  const quick = objectOrEmpty(product?.quick_status);
  const productId = product?.product_id || quick.productId || null;
  const instantBuy = optionalNumber(quick.sellPrice);
  const instantSell = optionalNumber(quick.buyPrice);
  const spread = instantBuy !== null && instantSell !== null ? instantBuy - instantSell : null;
  const spreadPercent = spread !== null && instantSell > 0 ? spread / instantSell * 100 : null;
  return {
    product_id: productId,
    name: itemNames.get(productId) || formatItemId(productId),
    instant_buy_price: instantBuy,
    instant_sell_price: instantSell,
    sell_offer_price: instantBuy,
    buy_order_price: instantSell,
    spread: spread === null ? null : round(spread, 4),
    spread_percent: spreadPercent === null ? null : round(spreadPercent, 3),
    sell_volume: optionalNumber(quick.sellVolume),
    buy_volume: optionalNumber(quick.buyVolume),
    sell_moving_week: optionalNumber(quick.sellMovingWeek),
    buy_moving_week: optionalNumber(quick.buyMovingWeek),
    sell_orders: optionalNumber(quick.sellOrders),
    buy_orders: optionalNumber(quick.buyOrders),
  };
}

function compareBazaarProducts(left, right, sort, order) {
  let comparison;
  if (sort === "product_id") {
    comparison = String(left.product_id || "").localeCompare(String(right.product_id || ""));
  } else if (sort === "moving_week") {
    comparison = number(left.buy_moving_week) + number(left.sell_moving_week) - number(right.buy_moving_week) - number(right.sell_moving_week);
  } else {
    const field = ({
      instant_buy: "instant_buy_price",
      instant_sell: "instant_sell_price",
      spread: "spread",
      spread_percent: "spread_percent",
      buy_volume: "buy_volume",
      sell_volume: "sell_volume",
    })[sort];
    comparison = number(left[field]) - number(right[field]);
  }
  return order === "desc" ? -comparison : comparison;
}

function compareSackItems(left, right, sort, order) {
  let comparison;
  if (sort === "item_id") {
    comparison = String(left.item_id || "").localeCompare(String(right.item_id || ""));
  } else if (sort === "name") {
    comparison = String(left.name || "").localeCompare(String(right.name || ""));
  } else {
    comparison = number(left.quantity) - number(right.quantity);
  }
  return order === "desc" ? -comparison : comparison;
}

async function compactAuction(auction, full = false) {
  const summary = {
    uuid: auction.uuid || null,
    auctioneer: auction.auctioneer || null,
    profile_id: auction.profile_id || null,
    start: optionalNumber(auction.start),
    end: optionalNumber(auction.end),
    item_name: cleanItemName(auction.item_name),
    extra: cleanItemName(auction.extra),
    category: auction.category || null,
    tier: auction.tier || null,
    bin: auction.bin === true,
    starting_bid: optionalNumber(auction.starting_bid),
    highest_bid_amount: optionalNumber(auction.highest_bid_amount),
    current_price: auctionPrice(auction),
    bid_count: Array.isArray(auction.bids) ? auction.bids.length : 0,
    claimed: auction.claimed ?? null,
  };
  if (!full) return summary;

  let decodedItem = null;
  let decodeError = null;
  if (auction.item_bytes) {
    const decoded = await decodeInventoryBlob(auction.item_bytes);
    decodedItem = decoded.records[0] ? expandNbtItem(decoded.records[0]) : null;
    decodeError = decoded.error;
  }
  return {
    ...summary,
    coop: sanitize(auction.coop || [], 3, 100),
    item_lore: cleanItemName(auction.item_lore),
    bids: sanitize(auction.bids || [], 6, 150),
    claimed_bidders: sanitize(auction.claimed_bidders || [], 4, 150),
    decoded_item: decodedItem,
    decode_error: decodeError,
  };
}

function resolveSkyBlockItem(itemNames, requested) {
  const requestedId = String(requested || "").trim().toLowerCase();
  for (const [id, name] of itemNames.entries()) {
    if (String(id).toLowerCase() === requestedId) return { id, name: cleanItemName(name) || formatItemId(id) };
  }

  const requestedName = normalizeItemSearchText(requested);
  const matches = [...itemNames.entries()].filter(([, name]) => normalizeItemSearchText(name) === requestedName);
  if (matches.length === 1) {
    const [id, name] = matches[0];
    return { id, name: cleanItemName(name) || formatItemId(id) };
  }
  if (matches.length > 1) return { ambiguous_ids: matches.map(([id]) => id).slice(0, 12) };
  return null;
}

function normalizeItemSearchText(value) {
  return String(cleanItemName(value) || "")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function skyBlockItemIdsMatch(left, right) {
  const normalize = (value) => String(value || "").toUpperCase().replace(/^STARRED_/, "");
  return normalize(left) === normalize(right);
}

async function compactEndedAuction(auction, full = false) {
  const summary = {
    auction_id: auction.auction_id || null,
    seller: auction.seller || null,
    seller_profile: auction.seller_profile || null,
    buyer: auction.buyer || null,
    buyer_profile: auction.buyer_profile || null,
    timestamp: optionalNumber(auction.timestamp),
    price: optionalNumber(auction.price),
    bin: auction.bin === true,
  };
  if (!full || !auction.item_bytes) return summary;
  const blob = typeof auction.item_bytes === "string" ? { data: auction.item_bytes } : auction.item_bytes;
  const decoded = await decodeInventoryBlob(blob);
  return {
    ...summary,
    decoded_item: decoded.records[0] ? expandNbtItem(decoded.records[0]) : null,
    decode_error: decoded.error,
  };
}

function auctionPrice(auction) {
  if (auction?.bin === true) return binPrice(auction);
  const highest = optionalNumber(auction?.highest_bid_amount);
  return highest !== null && highest > 0 ? highest : number(auction?.starting_bid);
}

function binPrice(auction) {
  return number(auction?.starting_bid);
}

async function loadSelectedMember(url, env) {
  const uuid = requireUuid(url);
  const selector = cleanSelector(url.searchParams.get("profile"));
  const profiles = await fetchProfiles(uuid, env);
  const profile = selectProfile(profiles, uuid, selector);
  const member = getMember(profile, uuid);
  if (!member) throw new ClientError("The player is not a member of that profile.", 404);
  return { uuid, profile, member };
}

async function fetchProfiles(uuid, env) {
  const payload = await fetchHypixelJson("/v2/skyblock/profiles", env, { uuid }, {
    authenticated: true,
    cacheSeconds: 0,
    timeoutMs: 12_000,
  });
  return Array.isArray(payload.profiles) ? payload.profiles : [];
}

async function fetchHypixelJson(path, env, parameters = {}, options = {}) {
  const endpoint = new URL(path, "https://api.hypixel.net");
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== null && value !== undefined && value !== "") endpoint.searchParams.set(key, String(value));
  }
  const headers = { "User-Agent": UPSTREAM_USER_AGENT, Accept: "application/json" };
  if (options.authenticated) headers["API-Key"] = env.HYPIXEL_API_KEY;
  return fetchJsonUpstream(endpoint, {
    headers,
    cacheKey: `hypixel:${endpoint.toString()}`,
    cacheSeconds: options.cacheSeconds || 0,
    timeoutMs: options.timeoutMs || 12_000,
    provider: "Hypixel",
  });
}

async function fetchJsonUpstream(endpoint, options) {
  const persistentCache = options.persistentCache && typeof caches !== "undefined" && caches.default;
  const persistentRequest = persistentCache ? new Request(endpoint.toString(), { method: "GET" }) : null;
  if (persistentCache) {
    const cachedResponse = await caches.default.match(persistentRequest);
    if (cachedResponse) {
      try {
        return await cachedResponse.json();
      } catch {
        await caches.default.delete(persistentRequest);
      }
    }
  }
  const cached = getMemoryCache(options.cacheKey);
  if (cached !== null) return cached;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 12_000);
  let response;
  try {
    response = await fetch(endpoint, { headers: options.headers, signal: controller.signal });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new UpstreamError(`${options.provider} took too long to respond.`, 504);
    }
    throw new UpstreamError(`${options.provider} could not be reached.`, 502);
  } finally {
    clearTimeout(timeout);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new UpstreamError(`${options.provider} returned a non-JSON response (${response.status}).`, response.status);
  }
  if (!response.ok || payload?.success === false) {
    const cause = payload?.cause || payload?.error || payload?.message || `${options.provider} request failed (${response.status}).`;
    const suffix = response.status === 429 ? " Respect Retry-After and try again later." : "";
    throw new UpstreamError(`${cause}${suffix}`, response.status);
  }
  if (options.cacheSeconds > 0) {
    setMemoryCache(options.cacheKey, payload, options.cacheSeconds);
    if (persistentCache) {
      await caches.default.put(persistentRequest, new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${options.cacheSeconds}`,
        },
      }));
    }
  }
  return payload;
}

function getMemoryCache(key) {
  if (!key) return null;
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function setMemoryCache(key, value, seconds) {
  if (!key || seconds <= 0) return;
  if (memoryCache.size >= 80) {
    const oldest = memoryCache.keys().next().value;
    if (oldest) memoryCache.delete(oldest);
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + seconds * 1_000 });
}

async function fetchSkyBlockItemNameMap(env) {
  const payload = await fetchHypixelJson("/v2/resources/skyblock/items", env, {}, {
    authenticated: false,
    cacheSeconds: 21_600,
  });
  return new Map((Array.isArray(payload.items) ? payload.items : []).map((item) => [item.id, item.name]));
}

async function fetchCollectionResource(env) {
  try {
    const payload = await fetchHypixelJson("/v2/resources/skyblock/collections", env, {}, {
      authenticated: false,
      cacheSeconds: 21_600,
      timeoutMs: 8_000,
    });
    return payload && payload.success !== false && payload.collections ? payload : null;
  } catch {
    return null;
  }
}

let cachedSkillResource = null;
let cachedSkillResourceExpiresAt = 0;

async function fetchSkillResource(env) {
  if (cachedSkillResource && Date.now() < cachedSkillResourceExpiresAt) {
    return cachedSkillResource;
  }

  try {
    const payload = await fetchHypixelJson("/v2/resources/skyblock/skills", env, {}, {
      authenticated: false,
      cacheSeconds: 21_600,
      timeoutMs: 8_000,
    });
    if (!payload || payload.success === false || !payload.skills) return null;

    cachedSkillResource = payload;
    cachedSkillResourceExpiresAt = Date.now() + 6 * 60 * 60 * 1_000;
    return payload;
  } catch {
    return null;
  }
}

function selectProfile(profiles, uuid, selector) {
  if (!profiles.length) {
    throw new ClientError("No SkyBlock profiles were found for this player.", 404);
  }

  if (selector) {
    const normalizedSelector = normalizeUuid(selector);
    const selected = profiles.find((profile) =>
      normalizeUuid(profile.profile_id || "") === normalizedSelector ||
      String(profile.cute_name || "").toLowerCase() === selector.toLowerCase()
    );

    if (!selected) {
      throw new ClientError("That profile ID or cute name was not found for this player.", 404);
    }
    return selected;
  }

  const active = profiles.find((profile) => profile.selected === true && !isDeleted(getMember(profile, uuid)));
  if (active) return active;

  return [...profiles]
    .filter((profile) => !isDeleted(getMember(profile, uuid)))
    .sort((a, b) => number(getMember(b, uuid)?.last_save) - number(getMember(a, uuid)?.last_save))[0] || profiles[0];
}

function compactProfile(profile, uuid) {
  const member = getMember(profile, uuid);
  const experience = optionalNumber(member?.leveling?.experience);

  return {
    profile_id: profile.profile_id || null,
    cute_name: profile.cute_name || null,
    selected: profile.selected === true,
    game_mode: profile.game_mode || "normal",
    player_is_member: Boolean(member),
    deleted: isDeleted(member),
    last_save: optionalNumber(member?.last_save),
    skyblock_experience: experience,
    skyblock_level: experience === null ? null : Math.floor(experience / 100),
  };
}

function buildOverview(profile, member, skillResource = null) {
  const experience = optionalNumber(member?.leveling?.experience);
  const currencies = member?.currencies || {};
  const purse = optionalNumber(currencies.coin_purse ?? member?.coin_purse);
  const profileBank = optionalNumber(profile?.banking?.balance);
  const personalBank = optionalNumber(
    member?.profile?.bank_account ??
    member?.profile?.personal_bank ??
    member?.bank_account
  );
  const availableBankParts = [profileBank, personalBank].filter((value) => value !== null);
  const availableBankBalance = availableBankParts.length
    ? availableBankParts.reduce((total, value) => total + value, 0)
    : null;
  const combinedBankBalance = profileBank !== null && personalBank !== null
    ? profileBank + personalBank
    : null;
  const bankBalanceScope = combinedBankBalance !== null
    ? "combined"
    : personalBank !== null
      ? "personal_only"
      : profileBank !== null
        ? "profile_only"
        : "unavailable";

  return {
    first_join: optionalNumber(member?.first_join),
    last_save: optionalNumber(member?.last_save),
    skyblock_experience: experience,
    skyblock_level_exact: experience === null ? null : experience / 100,
    skyblock_level_whole: experience === null ? null : Math.floor(experience / 100),
    skyblock_xp_into_current_level: experience === null ? null : experience % 100,
    currencies: sanitize({
      ...currencies,
      coin_purse: purse,
      bank_balance: availableBankBalance,
      bank_balance_scope: bankBalanceScope,
      personal_bank_balance: personalBank,
      profile_bank_balance: profileBank,
      combined_bank_balance: combinedBankBalance,
      bank_data_complete: combinedBankBalance !== null,
    }, 4),
    fairy_souls: sanitize(member?.fairy_soul || {
      total_collected: member?.fairy_souls_collected,
      unspent_souls: member?.fairy_souls,
    }, 3),
    skills: compactSkills(member, skillResource),
    slayers: compactSlayers(member),
    dungeons: compactDungeons(member),
  };
}

async function buildSection(section, profile, member, skillResource = null) {
  switch (section) {
    case "overview":
      return buildOverview(profile, member);
    case "skills":
      return compactSkills(member, skillResource);
    case "slayers":
      return compactSlayers(member);
    case "dungeons":
      return compactDungeons(member);
    case "collections":
      return sanitize(member.collection || member.player_data?.collection || {}, 4, 500);
    case "mining":
      return compactMining(member);
    case "forge":
      return compactForge(member);
    case "foraging":
      return compactForaging(member);
    case "stats":
      return compactStats(member, skillResource);
    case "gear":
      return await compactGear(member);
    case "pets":
      return compactPets(member);
    case "accessories":
      return await compactAccessories(member);
    case "bestiary":
      return sanitize(member.bestiary || {}, 5, 700);
    case "rift":
      return sanitize(member.rift || {}, 6, 500);
    default:
      return {};
  }
}

function compactSkills(member, skillResource = null) {
  const experience = collectSkillExperience(member);
  const skills = {};

  for (const [name, xp] of Object.entries(experience).sort(([left], [right]) => left.localeCompare(right))) {
    skills[name] = {
      experience: xp,
      ...calculateSkillProgress(name, xp, skillResource),
    };
  }

  const averageNames = [
    "farming",
    "mining",
    "combat",
    "foraging",
    "fishing",
    "enchanting",
    "alchemy",
    "taming",
  ];
  const calculated = averageNames
    .map((name) => skills[name])
    .filter((entry) => entry && entry.level !== null && entry.level !== undefined);
  const skillAverage = calculated.length
    ? calculated.reduce((sum, entry) => sum + entry.level, 0) / calculated.length
    : null;
  const trueSkillAverage = calculated.length
    ? calculated.reduce((sum, entry) => sum + (entry.level_with_progress ?? entry.level), 0) / calculated.length
    : null;

  return {
    available: Object.keys(skills).length > 0,
    levels_calculated: Object.values(skills).some((entry) => entry.level !== null),
    threshold_source: skillResource ? "Hypixel skills resource" : null,
    skill_average: skillAverage === null ? null : round(skillAverage, 2),
    true_skill_average: trueSkillAverage === null ? null : round(trueSkillAverage, 2),
    counted_skills: calculated.length,
    skills,
    reason: Object.keys(skills).length
      ? skillResource
        ? null
        : "Skill XP was exposed, but the live Hypixel skill thresholds could not be loaded, so levels were not guessed."
      : "Hypixel did not expose skill experience for this player on this profile.",
  };
}

function collectSkillExperience(member) {
  const result = {};
  const modern = member?.player_data?.experience;

  if (modern && typeof modern === "object" && !Array.isArray(modern)) {
    for (const [key, value] of Object.entries(modern)) {
      const name = normalizeSkillName(key);
      const xp = optionalNumber(value && typeof value === "object" ? value.experience ?? value.xp : value);
      if (name && xp !== null) result[name] = xp;
    }
  }

  for (const [key, value] of Object.entries(member || {})) {
    if (!key.startsWith("experience_skill_")) continue;
    const name = normalizeSkillName(key.replace("experience_skill_", ""));
    const xp = optionalNumber(value);
    if (name && xp !== null && result[name] === undefined) result[name] = xp;
  }

  return result;
}

function normalizeSkillName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^skill_/, "")
    .replace(/[^a-z0-9_]/g, "");
}

function calculateSkillProgress(skillName, experience, skillResource) {
  const definitions = skillResource?.skills;
  if (!definitions || typeof definitions !== "object") {
    return emptySkillProgress();
  }

  const definitionEntry = Object.entries(definitions).find(([key, value]) =>
    normalizeSkillName(key) === skillName || normalizeSkillName(value?.name) === skillName
  );
  const definition = definitionEntry?.[1];
  const levels = Array.isArray(definition?.levels) ? [...definition.levels] : [];
  if (!levels.length) return emptySkillProgress();

  let cumulative = 0;
  const thresholds = levels
    .map((entry, index) => {
      const level = optionalNumber(entry?.level) ?? index + 1;
      const explicitTotal = optionalNumber(
        entry?.totalExpRequired ?? entry?.total_exp_required ?? entry?.totalExperienceRequired
      );
      const required = optionalNumber(
        entry?.requiredExp ?? entry?.required_exp ?? entry?.experienceRequired ?? entry?.experience
      );
      if (explicitTotal !== null) cumulative = explicitTotal;
      else if (required !== null) cumulative += required;
      else return null;
      return { level, total: cumulative };
    })
    .filter(Boolean)
    .sort((left, right) => left.level - right.level);
  if (!thresholds.length) return emptySkillProgress();

  let level = 0;
  let currentThreshold = 0;
  let nextThreshold = thresholds[0].total;
  for (const threshold of thresholds) {
    if (experience < threshold.total) {
      nextThreshold = threshold.total;
      break;
    }
    level = threshold.level;
    currentThreshold = threshold.total;
    nextThreshold = null;
  }

  const maxLevel = optionalNumber(definition.maxLevel ?? definition.max_level) ?? thresholds.at(-1).level;
  const cappedLevel = Math.min(level, maxLevel);
  const xpIntoLevel = nextThreshold === null ? Math.max(0, experience - currentThreshold) : experience - currentThreshold;
  const xpForNextLevel = nextThreshold === null ? null : nextThreshold - currentThreshold;
  const progress = xpForNextLevel && xpForNextLevel > 0
    ? Math.max(0, Math.min(1, xpIntoLevel / xpForNextLevel))
    : 0;

  return {
    level: cappedLevel,
    level_with_progress: round(cappedLevel + (cappedLevel < maxLevel ? progress : 0), 4),
    max_level: maxLevel,
    xp_into_level: xpIntoLevel,
    xp_for_next_level: xpForNextLevel,
    progress_to_next_level: cappedLevel >= maxLevel ? 1 : round(progress, 6),
  };
}

function emptySkillProgress() {
  return {
    level: null,
    level_with_progress: null,
    max_level: null,
    xp_into_level: null,
    xp_for_next_level: null,
    progress_to_next_level: null,
  };
}

function compactMining(member) {
  const core = objectOrEmpty(member?.mining_core || member?.mining);
  const skillTree = objectOrEmpty(member?.skill_tree);
  const nodeGroups = objectOrEmpty(skillTree.nodes);
  const nodes = objectOrEmpty(nodeGroups.mining || core.nodes);
  const selectedAbilities = objectOrEmpty(skillTree.selected_ability);
  const perks = compactTreePerks(nodes, "mining", ["core_of_the_mountain"]);
  const hotmLevel = optionalNumber(
    nodes.core_of_the_mountain ?? core.core_of_the_mountain ?? core.level ?? core.tier
  );
  const hasTreeData = Object.keys(nodes).length > 0;
  const hasCoreProgress = Object.keys(core).some((key) => key !== "received_free_tier");
  const forge = compactForge(member);

  return {
    available: hasTreeData || hasCoreProgress || forge.forge_api_present,
    hotm_available: hasTreeData || hasCoreProgress,
    hotm: {
      level: hotmLevel,
      experience: firstNumber(
        readTreeScopedValue(skillTree, "experience", "mining"),
        core.experience,
        core.hotm_experience
      ),
      selected_ability: stringOrNull(
        selectedAbilities.mining ?? core.selected_ability ?? core.selected_pickaxe_ability
      ),
      tokens_available: firstNumber(
        readTreeScopedValue(skillTree, "tokens", "mining"),
        core.tokens
      ),
      tokens_spent: firstNumber(
        readTreeScopedValue(skillTree, "tokens_spent", "mining"),
        core.tokens_spent
      ),
      unlocked_perks: perks.length,
      perks,
      nodes: sanitize(nodes, 4, 400),
    },
    powder: {
      mithril: compactPowder(core, "mithril"),
      gemstone: compactPowder(core, "gemstone"),
      glacite: compactPowder(core, "glacite"),
    },
    crystals: sanitize(core.crystals || {}, 5, 100),
    biomes: sanitize(core.biomes || {}, 5, 100),
    glacite: sanitize(member?.glacite_player_data || {}, 6, 500),
    forge,
    mining_core: sanitize(core, 7, 700),
    reason: hasTreeData || hasCoreProgress
      ? null
      : core.received_free_tier === true
        ? "Hypixel returned only the free-tier flag. The profile's Skills API setting may not be exposing progression data."
        : "Hypixel did not expose Heart of the Mountain progression for this player on this profile.",
  };
}

function compactForge(member) {
  const candidates = [
    ["forge.forge_processes", member?.forge?.forge_processes],
    ["forge", member?.forge],
    ["forge_processes", member?.forge_processes],
    ["player_data.forge.forge_processes", member?.player_data?.forge?.forge_processes],
    ["mining_core.forge_processes", member?.mining_core?.forge_processes],
    ["mining.forge_processes", member?.mining?.forge_processes],
  ];
  const source = candidates.find(([, value]) => value && typeof value === "object" && !Array.isArray(value));
  const checkedAt = Date.now();

  if (!source) {
    return {
      available: false,
      forge_api_present: false,
      source_path: null,
      checked_at: checkedAt,
      checked_at_iso: isoFromUnixMs(checkedAt),
      active_processes: 0,
      slots_used: 0,
      processes: [],
      reason: "Hypixel did not expose Forge process data for this player on this profile.",
    };
  }

  const [sourcePath, root] = source;
  const processes = [];
  const visited = new WeakSet();
  const scan = (value, path, depth) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 6) return;
    if (visited.has(value)) return;
    visited.add(value);

    if (isForgeProcess(value)) {
      processes.push(compactForgeProcess(value, path, checkedAt));
      return;
    }
    for (const [key, child] of Object.entries(value).slice(0, 500)) {
      if (child && typeof child === "object" && !Array.isArray(child)) {
        scan(child, [...path, key], depth + 1);
      }
    }
  };
  scan(root, [], 0);
  processes.sort((left, right) =>
    String(left.forge_id || "").localeCompare(String(right.forge_id || ""), undefined, { numeric: true }) ||
    String(left.slot || "").localeCompare(String(right.slot || ""), undefined, { numeric: true })
  );

  return {
    available: true,
    forge_api_present: true,
    source_path: sourcePath,
    checked_at: checkedAt,
    checked_at_iso: isoFromUnixMs(checkedAt),
    active_processes: processes.length,
    slots_used: processes.length,
    processes,
    reason: processes.length
      ? null
      : "The Forge API section was present, but it contained no active or unclaimed processes.",
  };
}

function isForgeProcess(value) {
  const start = firstNumber(value.startTime, value.start_time, value.startedAt, value.started_at);
  const itemId = stringOrNull(value.id ?? value.item_id ?? value.itemId);
  const type = stringOrNull(value.type ?? value.process_type ?? value.processType);
  return start !== null && Boolean(itemId || type);
}

function compactForgeProcess(process, path, checkedAt) {
  const itemId = stringOrNull(process.id ?? process.item_id ?? process.itemId);
  const processType = stringOrNull(process.type ?? process.process_type ?? process.processType);
  const startTime = normalizeUnixMilliseconds(
    firstNumber(process.startTime, process.start_time, process.startedAt, process.started_at)
  );
  const upstreamEndTime = normalizeUnixMilliseconds(
    firstNumber(process.endTime, process.end_time, process.finishTime, process.finish_time, process.endsAt, process.ends_at)
  );
  const explicitDurationMs = firstNumber(
    process.duration_ms,
    process.durationMs,
    process.duration_milliseconds,
    process.durationMilliseconds
  );
  const explicitDurationSeconds = firstNumber(process.duration_seconds, process.durationSeconds);
  const durationMs = explicitDurationMs !== null
    ? Math.max(0, explicitDurationMs)
    : explicitDurationSeconds !== null
      ? Math.max(0, explicitDurationSeconds * 1_000)
      : null;
  const endTime = upstreamEndTime ?? (
    startTime !== null && durationMs !== null ? startTime + durationMs : null
  );
  const elapsedMs = startTime === null ? null : Math.max(0, checkedAt - startTime);
  const remainingMs = endTime === null ? null : Math.max(0, endTime - checkedAt);
  const complete = endTime === null ? null : checkedAt >= endTime;
  const progress = durationMs && elapsedMs !== null
    ? round(Math.max(0, Math.min(1, elapsedMs / durationMs)), 6)
    : null;

  return {
    path: path.join("."),
    forge_id: path.length > 1 ? path[0] : null,
    slot: path.length ? path.at(-1) : null,
    item_id: itemId,
    process_type: processType,
    start_time: startTime,
    start_time_iso: isoFromUnixMs(startTime),
    elapsed_ms: elapsedMs,
    duration_ms: durationMs,
    duration_raw: optionalNumber(process.duration),
    end_time: endTime,
    end_time_iso: isoFromUnixMs(endTime),
    end_time_calculated: upstreamEndTime === null && endTime !== null,
    remaining_ms: remainingMs,
    progress,
    complete,
    status: endTime === null ? "duration_required" : complete ? "finished_unclaimed" : "running",
    needs_wiki_duration: endTime === null,
    raw_process: sanitize(process, 4, 120),
  };
}

function compactForaging(member) {
  const core = objectOrEmpty(member?.foraging_core || member?.foraging);
  const skillTree = objectOrEmpty(member?.skill_tree);
  const nodeGroups = objectOrEmpty(skillTree.nodes);
  const nodes = objectOrEmpty(nodeGroups.foraging || core.nodes);
  const selectedAbilities = objectOrEmpty(skillTree.selected_ability);
  const perks = compactTreePerks(nodes, "foraging", [
    "core_of_the_forest",
    "heart_of_the_forest",
  ]);
  const hotfLevel = firstNumber(
    nodes.core_of_the_forest,
    nodes.heart_of_the_forest,
    core.level,
    core.tier
  );
  const whispersCurrent = firstNumber(core.forests_whispers, core.forest_whispers, core.whispers);
  const whispersSpent = firstNumber(
    core.forests_whispers_spent,
    core.forest_whispers_spent,
    core.whispers_spent
  );
  const whispersTotal = firstNumber(
    core.forests_whispers_total,
    core.forest_whispers_total,
    whispersCurrent !== null && whispersSpent !== null ? whispersCurrent + whispersSpent : null
  );
  const available = Object.keys(nodes).length > 0 || Object.keys(core).length > 0;

  return {
    available,
    hotf: {
      level: hotfLevel,
      experience: firstNumber(
        readTreeScopedValue(skillTree, "experience", "foraging"),
        core.experience,
        core.hotf_experience
      ),
      selected_ability: stringOrNull(selectedAbilities.foraging ?? core.selected_ability),
      tokens_available: firstNumber(
        readTreeScopedValue(skillTree, "tokens", "foraging"),
        core.tokens
      ),
      tokens_spent: firstNumber(
        readTreeScopedValue(skillTree, "tokens_spent", "foraging"),
        core.tokens_spent
      ),
      unlocked_perks: perks.length,
      perks,
      nodes: sanitize(nodes, 4, 400),
    },
    forest_whispers: {
      current: whispersCurrent,
      spent: whispersSpent,
      total_earned: whispersTotal,
    },
    daily_trees_cut: optionalNumber(core.daily_trees_cut),
    daily_log_cut: sanitize(core.daily_log_cut || [], 4, 100),
    foraging_core: sanitize(core, 7, 700),
    reason: available
      ? null
      : "Hypixel did not expose Heart of the Forest progression for this player on this profile.",
  };
}

function compactTreePerks(nodes, tree, excludedIds = []) {
  const excluded = new Set(excludedIds);
  const perks = [];

  for (const [id, value] of Object.entries(nodes)) {
    if (id.startsWith("toggle_") || excluded.has(id)) continue;
    const level = optionalNumber(value);
    if (level === null || level <= 0) continue;
    const toggle = nodes[`toggle_${id}`];
    perks.push({
      id,
      name: formatTreePerkName(id, tree),
      level,
      enabled: typeof toggle === "boolean" ? toggle : null,
    });
  }

  return perks.sort((left, right) => right.level - left.level || left.name.localeCompare(right.name));
}

function formatTreePerkName(id, tree) {
  const known = {
    core_of_the_mountain: "Core of the Mountain",
    mining_speed: "Mining Speed",
    mining_fortune: "Mining Fortune",
    efficient_miner: "Efficient Miner",
    great_explorer: "Great Explorer",
    daily_powder: "Daily Powder",
    professional: "Professional",
    mole: "Mole",
    powder_buff: "Powder Buff",
    pickobulus: "Pickobulus",
    maniac_miner: "Maniac Miner",
    sweep: "Sweep",
    foraging_fortune: "Foraging Fortune",
    daily_wishes: "Daily Wishes",
    axe_toss: "Axe Toss",
    speed_boost: "Speed Boost",
    center_of_the_forest: "Center of the Forest",
    galateas_might: "Galatea's Might",
  };
  if (known[id]) return known[id];
  return id
    .replace(/^toggle_/, "")
    .split("_")
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "")
    .join(" ");
}

function compactPowder(core, type) {
  const current = firstNumber(core[`powder_${type}`], core[`${type}_powder`]);
  const spent = firstNumber(core[`powder_spent_${type}`], core[`${type}_powder_spent`]);
  const total = firstNumber(
    core[`powder_${type}_total`],
    core[`total_powder_${type}`],
    current !== null && spent !== null ? current + spent : null
  );
  return { current, spent, total_earned: total };
}

function compactStats(member, skillResource = null) {
  const lifetime = objectOrEmpty(member?.player_stats);
  const skills = compactSkills(member, skillResource);

  return {
    skills,
    combat: {
      skill: skills.skills.combat || null,
      lifetime_counters: filterNumericStats(lifetime, /kill|death|damage|critical|slayer|dragon|dungeon|kuudra/i),
    },
    mining: {
      skill: skills.skills.mining || null,
      lifetime_counters: filterNumericStats(lifetime, /min(e|ed|ing)|ore|gemstone|mithril|titanium|glacite|nucleus|crystal|powder|commission/i),
    },
    foraging: {
      skill: skills.skills.foraging || null,
      lifetime_counters: filterNumericStats(lifetime, /forag|forest|tree|log|galatea/i),
    },
    farming: {
      skill: skills.skills.farming || null,
      lifetime_counters: filterNumericStats(lifetime, /farm|crop|garden|contest/i),
    },
    fishing: {
      skill: skills.skills.fishing || null,
      lifetime_counters: filterNumericStats(lifetime, /fish|sea_creature|trophy/i),
    },
    lifetime_counters: sanitize(lifetime, 6, 900),
    current_effective_stats: {
      available: false,
      reason: "Hypixel does not return one authoritative snapshot of current Health, Strength, Defense, Mining Speed, Mining Fortune, and similar gear/buff totals. Those must be derived from exposed gear, pets, perks, accessories, skills, and location-specific effects.",
    },
    reason: Object.keys(lifetime).length || skills.available
      ? null
      : "Hypixel did not expose skill experience or lifetime player-stat counters for this profile.",
  };
}

function filterNumericStats(stats, pattern, limit = 160) {
  const result = {};
  for (const [key, value] of Object.entries(stats)) {
    if (!pattern.test(key)) continue;
    if (!["number", "boolean", "string"].includes(typeof value)) continue;
    result[key] = value;
    if (Object.keys(result).length >= limit) break;
  }
  return result;
}

function readTreeScopedValue(skillTree, key, scope) {
  const value = skillTree?.[key];
  if (value && typeof value === "object" && !Array.isArray(value)) return value[scope];
  return value;
}

function compactSlayers(member) {
  const bosses = member?.slayer?.slayer_bosses || member?.slayer_bosses || {};
  const result = {};

  for (const [name, data] of Object.entries(bosses).slice(0, 30)) {
    result[name] = sanitize(data, 4, 100);
  }
  return result;
}

function compactDungeons(member) {
  const raw = member?.dungeons || {};
  const dungeonTypes = {};
  const classes = {};

  for (const [name, data] of Object.entries(raw.dungeon_types || {}).slice(0, 20)) {
    dungeonTypes[name] = pick(data, [
      "experience",
      "highest_tier_completed",
      "times_played",
      "tier_completions",
      "milestone_completions",
      "fastest_time",
      "fastest_time_s",
      "fastest_time_s_plus",
      "best_score",
    ]);
  }

  for (const [name, data] of Object.entries(raw.player_classes || {}).slice(0, 20)) {
    classes[name] = pick(data, ["experience"]);
  }

  return {
    selected_dungeon_class: raw.selected_dungeon_class || null,
    dungeon_types: sanitize(dungeonTypes, 5, 300),
    player_classes: sanitize(classes, 4, 100),
  };
}

function compactPets(member) {
  const pets = member?.pets_data?.pets || member?.pets || [];
  if (!Array.isArray(pets)) return [];

  return pets.slice(0, 250).map((pet) => pick(pet, [
    "uuid",
    "type",
    "exp",
    "active",
    "tier",
    "heldItem",
    "held_item",
    "candyUsed",
    "candy_used",
    "skin",
  ]));
}

async function compactAccessories(member) {
  const containers = findNbtContainers(member);
  const container = containers.find((entry) => entry.kind === "accessory_bag");
  const bagSettings = sanitize(member.accessory_bag_storage || {}, 6, 400);

  if (!container) {
    return {
      available: false,
      accessory_bag_api_present: false,
      total_accessories: 0,
      accessories: [],
      bag_settings: bagSettings,
      reason: "Hypixel did not include the talisman bag inventory. The player's Inventory API setting may be disabled.",
    };
  }

  const decoded = await decodeInventoryBlob(container.blob);
  if (decoded.error) {
    return {
      available: false,
      accessory_bag_api_present: true,
      total_accessories: 0,
      accessories: [],
      bag_settings: bagSettings,
      reason: "Hypixel returned the talisman bag, but the proxy could not decode it.",
      decode_error: decoded.error,
    };
  }

  const accessories = decoded.items.sort((left, right) => number(left.slot) - number(right.slot));
  return {
    available: true,
    accessory_bag_api_present: true,
    container: containerMetadata(container),
    total_accessories: accessories.length,
    accessories,
    bag_settings: bagSettings,
    reason: null,
  };
}

function findNbtContainers(member) {
  const found = new Map();
  const visited = new WeakSet();

  const scan = (value, path, depth) => {
    if (!value || typeof value !== "object" || depth > 8) return;
    if (visited.has(value)) return;
    visited.add(value);

    if (isNbtBlob(value)) {
      if (!found.has(path)) {
        found.set(path, {
          id: path,
          label: inventoryContainerLabel(path),
          kind: inventoryContainerKind(path),
          blob: value,
        });
      }
      return;
    }

    for (const [key, child] of Object.entries(value).slice(0, 2_000)) {
      if (child && typeof child === "object") scan(child, `${path}.${key}`, depth + 1);
    }
  };

  if (member?.inventory && typeof member.inventory === "object") {
    scan(member.inventory, "inventory", 0);
  }

  for (const [key, value] of Object.entries(member || {})) {
    if (key === "inventory" || !/(?:contents|inventory|armor|equipment|wardrobe|backpack|bag|quiver|vault)/i.test(key)) {
      continue;
    }
    if (value && typeof value === "object") scan(value, key, 0);
  }

  return [...found.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function findSacksCounts(member) {
  const candidates = [
    member?.inventory?.sacks_counts,
    member?.sacks_counts,
    member?.inventory?.bag_contents?.sacks_counts,
    member?.bag_contents?.sacks_counts,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  }
  return null;
}

function isNbtBlob(value) {
  if (!value || typeof value !== "object" || typeof value.data !== "string") return false;
  const data = value.data.replace(/\s+/g, "");
  if (data.length < 8) return false;
  return value.type !== undefined || /^[A-Za-z0-9+/_-]+={0,2}$/.test(data);
}

function containerMetadata(container) {
  const encoded = typeof container.blob === "string" ? container.blob : container.blob?.data || "";
  return {
    id: container.id,
    label: container.label,
    kind: container.kind,
    encoded_bytes_estimate: Math.floor(encoded.replace(/\s+/g, "").length * 0.75),
  };
}

function inventoryContainerKind(path) {
  const value = path.toLowerCase();
  if (/talisman|accessor/.test(value)) return "accessory_bag";
  if (/inv_armor|\.armor/.test(value)) return "armor";
  if (/equipment/.test(value)) return "equipment";
  if (/wardrobe/.test(value)) return "wardrobe";
  if (/ender_chest/.test(value)) return "ender_chest";
  if (/backpack/.test(value)) return "backpack";
  if (/personal_vault|vault/.test(value)) return "personal_vault";
  if (/fishing_bag/.test(value)) return "fishing_bag";
  if (/potion_bag/.test(value)) return "potion_bag";
  if (/quiver/.test(value)) return "quiver";
  if (/candy/.test(value)) return "candy_bag";
  if (/sacks?_bag/.test(value)) return "sacks_bag";
  if (/inv_contents/.test(value)) return "inventory";
  if (/bag/.test(value)) return "bag";
  return "other";
}

function inventoryContainerLabel(path) {
  const kind = inventoryContainerKind(path);
  const labels = {
    accessory_bag: "Accessory Bag",
    armor: "Worn Armor",
    equipment: "Equipment",
    wardrobe: "Wardrobe",
    ender_chest: "Ender Chest",
    backpack: "Backpack",
    personal_vault: "Personal Vault",
    fishing_bag: "Fishing Bag",
    potion_bag: "Potion Bag",
    quiver: "Quiver",
    candy_bag: "Candy Bag",
    sacks_bag: "Sacks Bag",
    inventory: "Main Inventory",
    bag: "Bag",
    other: "Item Container",
  };
  const suffix = kind === "backpack" ? ` (${path.split(".").at(-1)})` : "";
  return `${labels[kind]}${suffix}`;
}

async function compactGear(member) {
  const inventory = member?.inventory || {};
  const armorBlob = inventory.inv_armor ?? member?.inv_armor;
  const equipmentBlob = inventory.equipment_contents ?? member?.equipment_contents;
  const [armorResult, equipmentResult] = await Promise.all([
    decodeInventoryBlob(armorBlob),
    decodeInventoryBlob(equipmentBlob),
  ]);

  const armor = {
    helmet: null,
    chestplate: null,
    leggings: null,
    boots: null,
  };

  for (const [index, item] of armorResult.items.entries()) {
    const armorSlot = inferArmorSlot(item, index);
    if (armorSlot) armor[armorSlot] = item;
  }

  const equipment = equipmentResult.items
    .map((item) => ({ ...item, category: inferEquipmentCategory(item) }))
    .sort((left, right) => number(left.slot) - number(right.slot));

  const anyBlobPresent = armorResult.present || equipmentResult.present;
  const anyDecoded =
    (armorResult.present && !armorResult.error) ||
    (equipmentResult.present && !equipmentResult.error);
  const decodeErrors = {};
  if (armorResult.error) decodeErrors.armor = armorResult.error;
  if (equipmentResult.error) decodeErrors.equipment = equipmentResult.error;

  return {
    available: anyDecoded,
    armor_api_present: armorResult.present,
    equipment_api_present: equipmentResult.present,
    armor,
    equipment,
    reason: !anyBlobPresent
      ? "Hypixel did not include armor or equipment inventory data. The player's Inventory API setting may be disabled."
      : !anyDecoded
        ? "Hypixel returned inventory data, but the proxy could not decode it."
        : null,
    decode_errors: Object.keys(decodeErrors).length ? decodeErrors : null,
  };
}

async function decodeInventoryBlob(blob) {
  const encoded = typeof blob === "string" ? blob : blob?.data;
  if (typeof encoded !== "string" || !encoded.trim()) {
    return { present: false, items: [], records: [], error: null };
  }

  try {
    const compressed = decodeBase64(encoded);
    const uncompressed = await decompressGzip(compressed);
    const root = new NbtReader(uncompressed).readRoot();
    const rawItems = Array.isArray(root?.i) ? root.i : [];
    const records = rawItems
      .map((item, index) => {
        const summary = compactNbtItem(item, index);
        return summary ? { summary, raw: item } : null;
      })
      .filter(Boolean);
    return { present: true, items: records.map((record) => record.summary), records, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown NBT decoding error.";
    return { present: true, items: [], records: [], error: message.slice(0, 300) };
  }
}

function compactNbtItem(item, fallbackSlot) {
  if (!item || typeof item !== "object" || !Object.keys(item).length) return null;

  const tag = item.tag && typeof item.tag === "object" ? item.tag : {};
  const extra = tag.ExtraAttributes && typeof tag.ExtraAttributes === "object"
    ? tag.ExtraAttributes
    : item.ExtraAttributes && typeof item.ExtraAttributes === "object"
      ? item.ExtraAttributes
      : {};
  const display = tag.display && typeof tag.display === "object" ? tag.display : {};
  const skyblockId = stringOrNull(extra.id);
  const name = cleanItemName(display.Name || display.name || extra.display_name) || formatItemId(skyblockId);
  const vanillaId = optionalNumber(item.id);
  const rawSlot = optionalNumber(item.Slot);
  const slot = rawSlot !== null && rawSlot >= 0 ? rawSlot : fallbackSlot;

  if (!skyblockId && !name && (!vanillaId || vanillaId === 0)) return null;

  return {
    slot,
    name: name || "Unknown item",
    skyblock_id: skyblockId,
    count: optionalNumber(item.Count) ?? 1,
    reforge: stringOrNull(extra.modifier),
    stars: optionalNumber(extra.upgrade_level ?? extra.dungeon_item_level),
    recombobulated: number(extra.rarity_upgrades) > 0,
    attributes: extra.attributes && typeof extra.attributes === "object"
      ? Object.keys(extra.attributes).slice(0, 20)
      : [],
    enchantments: extra.enchantments && typeof extra.enchantments === "object"
      ? Object.keys(extra.enchantments).slice(0, 50)
      : [],
  };
}

function expandNbtItem(record) {
  const item = record.raw || {};
  const tag = item.tag && typeof item.tag === "object" ? item.tag : {};
  const extra = tag.ExtraAttributes && typeof tag.ExtraAttributes === "object"
    ? tag.ExtraAttributes
    : item.ExtraAttributes && typeof item.ExtraAttributes === "object"
      ? item.ExtraAttributes
      : {};
  const display = tag.display && typeof tag.display === "object" ? tag.display : {};
  const lore = Array.isArray(display.Lore)
    ? display.Lore.slice(0, 120).map(cleanItemName).filter(Boolean)
    : [];

  return {
    ...record.summary,
    minecraft_id: optionalNumber(item.id),
    damage: optionalNumber(item.Damage),
    lore,
    extra_attributes: sanitize(extra, 12, 1_500),
    nbt: sanitize(item, 12, 1_500),
  };
}

function inferArmorSlot(item, fallbackSlot) {
  const haystack = `${item.skyblock_id || ""} ${item.name || ""}`.toUpperCase();
  if (/HELMET|FEDORA|CROWN|MASK|GOGGLES/.test(haystack)) return "helmet";
  if (/CHESTPLATE|TUNIC/.test(haystack)) return "chestplate";
  if (/LEGGINGS|PANTS/.test(haystack)) return "leggings";
  if (/BOOTS|SHOES/.test(haystack)) return "boots";

  return ({ 0: "boots", 1: "leggings", 2: "chestplate", 3: "helmet" })[item.slot ?? fallbackSlot] || null;
}

function inferEquipmentCategory(item) {
  const haystack = `${item.skyblock_id || ""} ${item.name || ""}`.toUpperCase();
  if (haystack.includes("NECKLACE")) return "necklace";
  if (haystack.includes("CLOAK")) return "cloak";
  if (haystack.includes("BELT")) return "belt";
  if (haystack.includes("BRACELET")) return "bracelet";
  if (/GLOVE|GAUNTLET/.test(haystack)) return "gloves";
  return null;
}

function cleanItemName(value) {
  if (value === null || value === undefined) return null;
  let text = String(value);

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      text = flattenTextComponent(JSON.parse(text));
    } catch {
      // Keep the original string when it is not valid JSON text-component data.
    }
  }

  text = text.replace(/§[0-9A-FK-ORX]/gi, "").trim();
  return text || null;
}

function flattenTextComponent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenTextComponent).join("");
  if (!value || typeof value !== "object") return "";
  return `${value.text || ""}${Array.isArray(value.extra) ? value.extra.map(flattenTextComponent).join("") : ""}`;
}

function formatItemId(value) {
  if (!value) return null;
  return String(value)
    .replace(/^STARRED_/, "")
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

function getMember(profile, uuid) {
  const members = profile?.members;
  if (!members || typeof members !== "object") return null;

  const target = normalizeUuid(uuid);
  for (const [memberUuid, member] of Object.entries(members)) {
    if (normalizeUuid(memberUuid) === target) return member;
  }
  return null;
}

function isDeleted(member) {
  return Boolean(member?.profile?.deletion_notice || member?.deletion_notice);
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
