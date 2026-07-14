import { ClientError, json, privacyPolicy, UpstreamError } from "./http.js";
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
import {
  handleAuctionLookup,
  handleAuctionPage,
  handleBazaarProduct,
  handleBazaarProducts,
  handleEndedAuctions,
  handleLowestBin,
} from "./routes/market.js";
import { handleFeed, handleResources } from "./routes/misc.js";

const ROUTES = new Map([
  ["/v1/player/profiles", handleProfiles],
  ["/v1/player/summary", handleSummary],
  ["/v1/player/section", handleSection],
  ["/v1/player/collections", handlePlayerCollections],
  ["/v1/player/accessories", handlePlayerAccessories],
  ["/v1/player/inventories", handleInventoryIndex],
  ["/v1/player/inventory", handleInventoryContainer],
  ["/v1/player/item", handleInventoryItem],
  ["/v1/player/sacks", handleSacks],
  ["/v1/player/extra", handlePlayerExtra],
  ["/v1/resources", handleResources],
  ["/v1/feed", handleFeed],
  ["/v1/bazaar/products", handleBazaarProducts],
  ["/v1/bazaar/product", handleBazaarProduct],
  ["/v1/auctions/page", handleAuctionPage],
  ["/v1/auctions/lowest-bin", handleLowestBin],
  ["/v1/auctions/lookup", handleAuctionLookup],
  ["/v1/auctions/ended", handleEndedAuctions],
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
        version: "2.5.1",
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
      const handler = ROUTES.get(url.pathname);
      if (!handler) {
        return json({ success: false, error: "Route not found." }, 404);
      }
      return await handler(url, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected proxy error.";
      const status = error instanceof ClientError || error instanceof UpstreamError ? error.status : 500;
      return json({ success: false, error: message }, status);
    }
  },
};

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
