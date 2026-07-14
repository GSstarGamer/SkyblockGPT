import { number, optionalNumber } from "../util.js";
import { ClientError, json, UpstreamError } from "../http.js";
import { readIntegerParameter, requireContainerId } from "../params.js";
import {
  containerMetadata,
  decodeInventoryBlob,
  expandNbtItem,
  findNbtContainers,
  findSacksCounts,
} from "../items.js";
import { compactProfile, loadSelectedMember } from "../profiles.js";

export async function handleInventoryIndex(url, env) {
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

export async function handleInventoryContainer(url, env) {
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

export async function handleInventoryItem(url, env) {
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
