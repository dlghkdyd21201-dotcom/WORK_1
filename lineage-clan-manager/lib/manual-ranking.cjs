"use strict";

function normalizeManualRank(value) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 5000)
    throw new Error("수동 순위는 1~5,000 사이의 정수여야 합니다.");
  return value;
}

function compareIdentity(a, b) {
  return a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id);
}

function rankMembers(members) {
  return members
    .map((member) => {
      const manualRank = normalizeManualRank(member.manualRank);
      return { ...member, manualRank, rank: manualRank };
    })
    .sort((a, b) => {
      if (a.manualRank !== null && b.manualRank !== null)
        return a.manualRank - b.manualRank || compareIdentity(a, b);
      if (a.manualRank !== null) return -1;
      if (b.manualRank !== null) return 1;
      return b.level - a.level || compareIdentity(a, b);
    });
}

function hydrateManualRanks(data) {
  const archivedMembers = data.legacyImport?.sourceBackup?.data?.members;
  const sourceRanks = new Map();
  if (Array.isArray(archivedMembers)) {
    for (const member of archivedMembers) {
      if (member && typeof member === "object" && !sourceRanks.has(member.id))
        sourceRanks.set(member.id, member.rank);
    }
  }
  let restoredCount = 0;
  let changed = false;
  const members = data.members.map((member) => {
    // A stored null records a deliberate clear and must never be restored.
    if (Object.hasOwn(member, "manualRank")) return member;
    const sourceRank = sourceRanks.get(member.id);
    const manualRank =
      Number.isInteger(sourceRank) && sourceRank >= 1 && sourceRank <= 5000
        ? sourceRank
        : null;
    if (manualRank !== null) restoredCount++;
    changed = true;
    return { ...member, manualRank };
  });
  return {
    data: changed ? { ...data, members } : data,
    restoredCount,
    changed,
  };
}

module.exports = { rankMembers, normalizeManualRank, hydrateManualRanks };
