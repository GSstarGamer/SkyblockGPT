import { fetchProfiles } from "./hypixel.js";
import { ClientError } from "./http.js";
import { cleanSelector, normalizeUuid, requireUuid } from "./params.js";
import { number, optionalNumber } from "./util.js";

export async function loadSelectedMember(url, env) {
  const uuid = requireUuid(url);
  const selector = cleanSelector(url.searchParams.get("profile"));
  const profiles = await fetchProfiles(uuid, env);
  const profile = selectProfile(profiles, uuid, selector);
  const member = getMember(profile, uuid);
  if (!member) throw new ClientError("The player is not a member of that profile.", 404);
  return { uuid, profile, member };
}

export function selectProfile(profiles, uuid, selector) {
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

export function compactProfile(profile, uuid) {
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

export function getMember(profile, uuid) {
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
