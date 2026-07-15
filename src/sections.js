import {
  createTruncationReport,
  firstNumber,
  isoFromUnixMs,
  normalizeUnixMilliseconds,
  objectOrEmpty,
  optionalNumber,
  paginateRecords,
  pick,
  round,
  sanitize,
  stringOrNull,
} from "./util.js";
import { normalizeUuid } from "./params.js";
import {
  cleanItemName,
  compactAccessories,
  compactGear,
  decodeInventoryBlob,
  formatItemId,
} from "./items.js";

export const PROFILE_SECTIONS = new Set([
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

export function compactGarden(garden) {
  const value = objectOrEmpty(garden);
  const report = createTruncationReport();
  const sanitized = sanitize({
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
  }, 10, 2_000, report);
  // The flag is attached after sanitize runs so it is not itself subject to
  // the depth/entry limits it describes.
  return { ...sanitized, garden_truncated: report.truncated };
}

const MUSEUM_ITEMS_PER_ENTRY = 8;

export async function compactMuseum(profileData, query, page, limit) {
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
        donated_time: optionalNumber(itemData?.donated_time),
        blob: itemData?.items ?? null,
      });
    }
    for (const [index, special] of (Array.isArray(museum.special) ? museum.special : []).entries()) {
      memberEntries.push({
        member_uuid: normalizeUuid(memberUuid),
        source: "special",
        special_index: index,
        item_id: null,
        donated_time: optionalNumber(special?.donated_time),
        blob: special?.items ?? null,
      });
    }
    members.push({
      member_uuid: normalizeUuid(memberUuid),
      value: optionalNumber(museum.value),
      appraisal: museum.appraisal ?? null,
      total_entries: memberEntries.length,
    });
    entries.push(...memberEntries);
  }

  // Query matches identifiers only. It previously ran over JSON.stringify of the
  // entry, which meant it searched truncated base64 — never a useful match.
  const filtered = entries.filter((entry) => !query ||
    `${entry.item_id || ""} ${entry.source} ${entry.member_uuid}`.toLowerCase().includes(query));
  const pagination = paginateRecords(filtered, page, limit);

  // Decode only this page. Museums hold hundreds of items; decoding all of them
  // would be base64 + gzip + a full NBT walk each. A single entry can hold more
  // than one item — a donated armor set carries every piece in one blob — so
  // report the whole list rather than just the first. Cap and flag per entry,
  // mirroring compactNbtItem's attributes/enchantments caps in items.js, so a
  // uniform page of multi-piece sets can't push a response over the size cap.
  const items = await Promise.all(pagination.items.map(async ({ blob, ...entry }) => {
    if (!blob) {
      return { ...entry, blob_present: false, decoded_items: [], decoded_items_truncated: false, decode_error: null };
    }
    const decoded = await decodeInventoryBlob(blob);
    const summaries = decoded.records.map((record) => record.summary);
    return {
      ...entry,
      blob_present: decoded.present,
      decoded_items: summaries.slice(0, MUSEUM_ITEMS_PER_ENTRY),
      decoded_items_truncated: summaries.length > MUSEUM_ITEMS_PER_ENTRY,
      decode_error: decoded.error,
    };
  }));

  return {
    members,
    query: query || null,
    ...pagination,
    items,
  };
}

export function flattenCollections(collections) {
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

export function compactCollectionItem(item) {
  return sanitize(pick(item, [
    "category_id", "category_name", "id", "name", "maxTiers", "tiers", "bossCollection", "mobs",
  ]), 7, 300);
}

export function compactPlayerCollections(member, resource, query, page, limit, includeUnlocks = false) {
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

export function buildOverview(profile, member, skillResource = null) {
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

export async function buildSection(section, profile, member, skillResource = null) {
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
  const lifetimeCountersReport = createTruncationReport();

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
    lifetime_counters: sanitize(lifetime, 6, 900, lifetimeCountersReport),
    lifetime_counters_truncated: lifetimeCountersReport.truncated,
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
  const walk = (value, prefix, depth) => {
    if (depth > 4) return;
    for (const [key, item] of Object.entries(value)) {
      if (Object.keys(result).length >= limit) return;
      const path = prefix ? `${prefix}.${key}` : key;
      if (item && typeof item === "object" && !Array.isArray(item)) {
        walk(item, path, depth + 1);
      } else if (["number", "boolean", "string"].includes(typeof item) && pattern.test(path)) {
        result[path] = item;
      }
    }
  };
  walk(objectOrEmpty(stats), "", 0);
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

