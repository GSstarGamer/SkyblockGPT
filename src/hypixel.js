import { UpstreamError } from "./http.js";

const UPSTREAM_USER_AGENT = "SkyblockGPT/2.5.1 (contact: Discord gs._)";
const memoryCache = new Map();

export async function fetchProfiles(uuid, env) {
  const payload = await fetchHypixelJson("/v2/skyblock/profiles", env, { uuid }, {
    authenticated: true,
    cacheSeconds: 0,
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

export async function fetchSkyBlockItemNameMap(env) {
  const payload = await fetchHypixelJson("/v2/resources/skyblock/items", env, {}, {
    authenticated: false,
    cacheSeconds: 21_600,
  });
  return new Map((Array.isArray(payload.items) ? payload.items : []).map((item) => [item.id, item.name]));
}

export async function fetchCollectionResource(env) {
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

export async function fetchSkillResource(env) {
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
