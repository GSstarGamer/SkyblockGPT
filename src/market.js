import { cleanItemName, decodeInventoryBlob, expandNbtItem, formatItemId } from "./items.js";
import { number, objectOrEmpty, optionalNumber, round, sanitize } from "./util.js";

export function compactBazaarProduct(product, itemNames) {
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

export function compareBazaarProducts(left, right, sort, order) {
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

export async function compactAuction(auction, full = false) {
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

export function resolveSkyBlockItem(itemNames, requested) {
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

export function normalizeItemSearchText(value) {
  return String(cleanItemName(value) || "")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function skyBlockItemIdsMatch(left, right) {
  const normalize = (value) => String(value || "").toUpperCase().replace(/^STARRED_/, "");
  return normalize(left) === normalize(right);
}

export async function compactEndedAuction(auction, full = false) {
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

export function auctionPrice(auction) {
  if (auction?.bin === true) return binPrice(auction);
  const highest = optionalNumber(auction?.highest_bid_amount);
  return highest !== null && highest > 0 ? highest : number(auction?.starting_bid);
}

export function binPrice(auction) {
  return number(auction?.starting_bid);
}
