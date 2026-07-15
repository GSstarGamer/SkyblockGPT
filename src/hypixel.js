import { UpstreamError } from "./http.js";

const UPSTREAM_USER_AGENT = "SkyblockGPT/2.6.0 (contact: Discord gs._)";
const memoryCache = new Map();
let cachedSkillResource = null;
let cachedSkillResourceExpiresAt = 0;

// Cache TTL in seconds, keyed by upstream path. Caching is opt-in: anything
// absent gets 0. Player data is never cached (AGENTS.md, /privacy) and market
// data changes too fast to be worth staleness.
const CACHE_POLICY = new Map([
  ["/v2/skyblock/profiles", 0],
  ["/v2/skyblock/museum", 0],
  ["/v2/skyblock/garden", 0],
  ["/v2/skyblock/bingo", 0],
  ["/v2/skyblock/bazaar", 0],
  ["/v2/skyblock/auctions", 0],
  ["/v2/skyblock/auction", 0],
  ["/v2/skyblock/auctions_ended", 0],
  ["/v2/skyblock/firesales", 60],
  ["/v2/resources/skyblock/election", 60],
  ["/v2/skyblock/news", 300],
  ["/v2/resources/skyblock/bingo", 300],
  ["/v2/resources/skyblock/items", 21_600],
  ["/v2/resources/skyblock/skills", 21_600],
  ["/v2/resources/skyblock/collections", 21_600],
]);

function cacheSecondsFor(path) {
  return CACHE_POLICY.get(path) ?? 0;
}

export function resetCaches() {
  memoryCache.clear();
  cachedSkillResource = null;
  cachedSkillResourceExpiresAt = 0;
}

export async function fetchProfiles(uuid, env) {
  const payload = await fetchHypixelJson("/v2/skyblock/profiles", env, { uuid }, {
    authenticated: true,
    timeoutMs: 12_000,
  });
  return Array.isArray(payload.profiles) ? payload.profiles : [];
}

export async function fetchHypixelJson(path, env, parameters = {}, options = {}) {
  const endpoint = new URL(path, "https://api.hypixel.net");
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== null && value !== undefined && value !== "") endpoint.searchParams.set(key, String(value));
  }
  const headers = { "User-Agent": UPSTREAM_USER_AGENT, Accept: "application/json" };
  if (options.authenticated) headers["API-Key"] = env.HYPIXEL_API_KEY;
  return fetchJsonUpstream(endpoint, {
    headers,
    cacheKey: `hypixel:${endpoint.toString()}`,
    cacheSeconds: cacheSecondsFor(path),
    timeoutMs: options.timeoutMs || 12_000,
    provider: "Hypixel",
  });
}

async function fetchJsonUpstream(endpoint, options) {
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

export async function fetchSkyBlockItemNameMap(env) {
  const payload = await fetchHypixelJson("/v2/resources/skyblock/items", env, {}, {
    authenticated: false,
  });
  return new Map((Array.isArray(payload.items) ? payload.items : []).map((item) => [item.id, item.name]));
}

export async function fetchCollectionResource(env) {
  try {
    const payload = await fetchHypixelJson("/v2/resources/skyblock/collections", env, {}, {
      authenticated: false,
      timeoutMs: 8_000,
    });
    return payload && payload.success !== false && payload.collections ? payload : null;
  } catch {
    return null;
  }
}

export async function fetchSkillResource(env) {
  if (cachedSkillResource && Date.now() < cachedSkillResourceExpiresAt) {
    return cachedSkillResource;
  }

  try {
    const payload = await fetchHypixelJson("/v2/resources/skyblock/skills", env, {}, {
      authenticated: false,
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
