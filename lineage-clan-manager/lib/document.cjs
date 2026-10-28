"use strict";

const {
  ENTRY_SIZE,
  validateEntrySettings,
  validateEntryMember,
} = require("./entry.cjs");

function reject(message) {
  throw new Error(message);
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    reject(`${label} 형식이 올바르지 않습니다.`);
}

function text(value, label, max, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    reject(`${label} 값을 확인해 주세요.`);
}

function identifier(value, label = "기록 ID") {
  text(value, label, 100, true);
  if (value !== value.trim())
    reject(`${label} 앞뒤에 공백을 넣을 수 없습니다.`);
}

function timestampFields(value) {
  for (const field of ["createdAt", "updatedAt"]) {
    if (!Object.hasOwn(value, field)) continue;
    if (
      typeof value[field] !== "string" ||
      value[field].length > 50 ||
      !Number.isFinite(Date.parse(value[field]))
    )
      reject("기록 생성·수정 시각이 올바르지 않습니다.");
  }
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    reject("전투 날짜 형식이 올바르지 않습니다.");
  const parsed = new Date(`${value}T12:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    reject("실제 존재하는 전투 날짜를 입력해 주세요.");
}

function participant(value) {
  record(value, "전투 참여자");
  identifier(value.id, "참여자 ID");
  text(value.name, "참여자 이름", 40, true);
  text(value.class, "참여자 클래스", 40, true);
}

function finalEntry(value) {
  record(value, "확정 엔트리");
  if (
    typeof value.confirmedAt !== "string" ||
    value.confirmedAt.length > 50 ||
    !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value.confirmedAt,
    ) ||
    !Number.isFinite(Date.parse(value.confirmedAt))
  )
    reject("엔트리 확정 시각은 유효한 ISO 형식이어야 합니다.");
  const confirmedDate = value.confirmedAt.slice(0, 10);
  if (
    new Date(`${confirmedDate}T12:00:00Z`).toISOString().slice(0, 10) !==
    confirmedDate
  )
    reject("엔트리 확정 날짜가 올바르지 않습니다.");
  validateEntrySettings(value.settings);
  if (!Array.isArray(value.members) || value.members.length !== ENTRY_SIZE)
    reject("확정 엔트리는 정확히 15명이어야 합니다.");
  const absentIds = new Set(value.settings.absentIds);
  const ids = new Set();
  const counts = new Map();
  for (const member of value.members) {
    validateEntryMember(member);
    if (!Number.isInteger(member.rank) || member.rank < 1 || member.rank > 5000)
      reject("확정 엔트리 순위는 1~5,000 사이의 정수여야 합니다.");
    if (ids.has(member.id)) reject("확정 엔트리 혈맹원 ID가 중복되었습니다.");
    if (absentIds.has(member.id))
      reject("불참자는 확정 엔트리에 포함할 수 없습니다.");
    ids.add(member.id);
    counts.set(member.class, (counts.get(member.class) || 0) + 1);
  }
  if (value.settings.mode === "class") {
    for (const [className, count] of counts) {
      if (value.settings.classQuotas[className] !== count)
        reject("확정 엔트리와 클래스별 정원이 일치하지 않습니다.");
    }
  }
  // Snapshots are independent of the current roster and current draft settings.
}

function validateDocument(data) {
  record(data, "혈맹 자료");
  if (!Array.isArray(data.members) || data.members.length > 5000)
    reject("혈맹원 목록 형식이 올바르지 않습니다.");
  const memberIds = new Set();
  const memberNames = new Set();
  for (const member of data.members) {
    record(member, "혈맹원");
    identifier(member.id, "혈맹원 ID");
    text(member.name, "캐릭터 이름", 40, true);
    text(member.class, "클래스", 40, true);
    text(member.role, "혈맹 직위", 30, true);
    text(member.note, "혈맹원 메모", 2000);
    if (
      !Number.isInteger(member.level) ||
      member.level < 1 ||
      member.level > 200
    )
      reject("혈맹원 레벨은 1~200 사이의 정수여야 합니다.");
    if (
      !Number.isFinite(member.experience) ||
      member.experience < 0 ||
      member.experience > 100
    )
      reject("혈맹원 경험치는 0~100% 사이의 숫자여야 합니다.");
    if (memberIds.has(member.id)) reject("혈맹원 ID가 중복되었습니다.");
    memberIds.add(member.id);
    const name = member.name.normalize("NFC").trim().toLocaleLowerCase("ko");
    if (memberNames.has(name)) reject("같은 이름의 혈맹원이 중복되었습니다.");
    memberNames.add(name);
    timestampFields(member);
  }

  if (Object.hasOwn(data, "battles")) {
    if (!Array.isArray(data.battles) || data.battles.length > 10000)
      reject("던전 전투 목록 형식이 올바르지 않습니다.");
    const battleIds = new Set();
    for (const battle of data.battles) {
      record(battle, "던전 전투");
      identifier(battle.id, "전투 ID");
      if (battleIds.has(battle.id)) reject("전투 ID가 중복되었습니다.");
      battleIds.add(battle.id);
      text(battle.dungeon, "던전 이름", 100, true);
      validDate(battle.date);
      if (
        typeof battle.time !== "string" ||
        (battle.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(battle.time))
      )
        reject("전투 시간은 24시간 형식으로 입력해 주세요.");
      if (!["성공", "실패", "중단"].includes(battle.result))
        reject("전투 결과 형식이 올바르지 않습니다.");
      if (
        !Number.isInteger(battle.durationMinutes) ||
        battle.durationMinutes < 0 ||
        battle.durationMinutes > 10080
      )
        reject("전투 소요 시간은 0~10,080분 사이의 정수여야 합니다.");
      text(battle.loot, "보상·획득 아이템", 2000);
      text(battle.note, "전투 메모", 5000);
      if (
        !Array.isArray(battle.participantIds) ||
        battle.participantIds.length < 1 ||
        battle.participantIds.length > 1000
      )
        reject("전투 참여자 목록을 확인해 주세요.");
      const ids = new Set();
      for (const id of battle.participantIds) {
        identifier(id, "참여자 ID");
        if (ids.has(id)) reject("같은 전투 참여자가 중복되었습니다.");
        ids.add(id);
      }
      if (
        !Array.isArray(battle.participants) ||
        battle.participants.length !== battle.participantIds.length
      )
        reject("전투 참여자 정보와 참여 ID 목록이 일치하지 않습니다.");
      const snapshots = new Set();
      for (const snapshot of battle.participants) {
        participant(snapshot);
        if (!ids.has(snapshot.id) || snapshots.has(snapshot.id))
          reject("전투 참여자 정보와 참여 ID 목록이 일치하지 않습니다.");
        snapshots.add(snapshot.id);
      }
      // Historical snapshots remain valid after a member leaves the roster.
      timestampFields(battle);
    }
  }
  if (Object.hasOwn(data, "entrySettings"))
    validateEntrySettings(data.entrySettings);
  if (Object.hasOwn(data, "finalEntry")) finalEntry(data.finalEntry);
  return data;
}

module.exports = { validateDocument };
