import { ClientError } from "./http.js";

export const UUID_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
export const GENERIC_UUID_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
export const ITEM_TAG_PATTERN = /^[A-Za-z0-9_:+;.-]{1,120}$/;

export function requireContainerId(url) {
  const container = (url.searchParams.get("container") || "").trim();
  if (!container || container.length > 240) {
    throw new ClientError("A valid inventory container ID from the inventory index is required.", 400);
  }
  return container;
}

export function readIntegerParameter(url, name, fallback, minimum, maximum) {
  const raw = url.searchParams.get(name);
  if ((raw === null || raw === "") && fallback !== null) return fallback;
  if (raw === null || raw === "") throw new ClientError(`${name} is required.`, 400);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ClientError(`${name} must be an integer from ${minimum} through ${maximum}.`, 400);
  }
  return value;
}

export function readTextParameter(url, name, maximum, fallback = "") {
  const value = (url.searchParams.get(name) || fallback).trim();
  if (value.length > maximum) throw new ClientError(`${name} must be at most ${maximum} characters.`, 400);
  return value;
}

export function requireEnumParameter(url, name, allowed, fallback = null) {
  const value = (url.searchParams.get(name) || fallback || "").trim().toLowerCase();
  if (!value || !allowed.has(value)) {
    throw new ClientError(`${name} must be one of: ${[...allowed].join(", ")}.`, 400);
  }
  return value;
}

export function readOptionalBooleanParameter(url, name) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return null;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new ClientError(`${name} must be true or false.`, 400);
}

export function readDetailParameter(url) {
  const detail = (url.searchParams.get("detail") || "summary").toLowerCase();
  if (!new Set(["summary", "full"]).has(detail)) throw new ClientError("detail must be summary or full.", 400);
  return detail;
}

export function requireItemTag(url, name) {
  const value = readTextParameter(url, name, 120, "");
  if (!ITEM_TAG_PATTERN.test(value)) {
    throw new ClientError(`${name} must be a valid SkyBlock item or product ID.`, 400);
  }
  return value;
}

export function requireUuid(url) {
  const raw = (url.searchParams.get("uuid") || "").trim();
  if (!UUID_PATTERN.test(raw)) {
    throw new ClientError("A valid dashed or undashed Minecraft UUID is required.", 400);
  }
  return normalizeUuid(raw);
}

export function cleanSelector(value) {
  const selector = (value || "").trim();
  if (!selector) return null;
  if (selector.length > 64) throw new ClientError("The profile selector is too long.", 400);
  return selector;
}

export function normalizeUuid(value) {
  return String(value || "").replaceAll("-", "").toLowerCase();
}
