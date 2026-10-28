import React, { useEffect, useMemo, useRef, useState } from "react";
import { validateBattle } from "./domain.js";
import "./Dungeon.css";

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function BattleIcon({ name = "swords", size = 22 }) {
  const paths = {
    swords: (
      <>
        <path d="m4 3 17 17M3 3l1 6 5-5-6-1ZM15 16l-2 2M16 15l2-2M20 3 3 20M21 3l-1 6-5-5 6-1ZM8 15l3 3M6 17l-2-2" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    flag: (
      <>
        <path d="M5 21V4M5 4c5-4 9 4 14 0v10c-5 4-9-4-14 0" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.swords}
    </svg>
  );
}

function createBattle() {
  return {
    id: crypto.randomUUID(),
    dungeon: "",
    date: localDate(),
    time: localTime(),
    result: "성공",
    participantIds: [],
    participants: [],
    durationMinutes: "",
    loot: "",
    note: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const resultStyle = { 성공: "success", 실패: "failure", 중단: "stopped" };

export default function Dungeon({
  members = [],
  data = {},
  onSave,
  disabled = false,
}) {
  const battles = Array.isArray(data.battles) ? data.battles : [];
  const [query, setQuery] = useState("");
  const [resultFilter, setResultFilter] = useState("전체");
  const [memberFilter, setMemberFilter] = useState("전체");
  const [draft, setDraft] = useState(null);
  const [formError, setFormError] = useState("");
  const [listError, setListError] = useState("");
  const [saving, setSaving] = useState(false);
  const dialog = useRef(null);
  const busy = disabled || saving;

  useEffect(() => {
    if (draft && dialog.current && !dialog.current.open)
      dialog.current.showModal();
    if (!draft && dialog.current?.open) dialog.current.close();
  }, [Boolean(draft)]);

  const knownParticipants = useMemo(() => {
    const entries = new Map();
    for (const battle of battles)
      for (const participant of battle.participants || [])
        entries.set(participant.id, participant);
    for (const member of members) entries.set(member.id, member);
    return [...entries.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "ko"),
    );
  }, [members, battles]);

  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return battles
      .filter((battle) => {
        if (resultFilter !== "전체" && battle.result !== resultFilter)
          return false;
        if (
          memberFilter !== "전체" &&
          !battle.participantIds?.includes(memberFilter)
        )
          return false;
        return (
          !search ||
          [
            battle.dungeon,
            battle.loot,
            battle.note,
            ...(battle.participants || []).map((entry) => entry.name),
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(search)
        );
      })
      .sort(
        (a, b) =>
          `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`) ||
          (b.createdAt || "").localeCompare(a.createdAt || ""),
      );
  }, [battles, query, resultFilter, memberFilter]);

  const completed = battles.filter((battle) => battle.result === "성공").length;
  const totalParticipants = new Set(
    battles.flatMap((battle) => battle.participantIds || []),
  ).size;
  const editing = Boolean(
    draft && battles.some((battle) => battle.id === draft.id),
  );
  const draftParticipants = useMemo(() => {
    const entries = new Map(
      (draft?.participants || []).map((participant) => [
        participant.id,
        { ...participant, removed: true },
      ]),
    );
    for (const member of members)
      entries.set(member.id, {
        id: member.id,
        name: member.name,
        class: member.class,
        removed: false,
      });
    return [...entries.values()];
  }, [members, draft?.id]);

  function openEditor(battle) {
    setFormError("");
    setDraft(
      battle
        ? {
            ...battle,
            participantIds: [...(battle.participantIds || [])],
            participants: [...(battle.participants || [])],
          }
        : createBattle(),
    );
  }

  function closeEditor() {
    if (!busy) {
      setDraft(null);
      setFormError("");
    }
  }

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function toggleParticipant(id) {
    setDraft((current) => ({
      ...current,
      participantIds: current.participantIds.includes(id)
        ? current.participantIds.filter((entry) => entry !== id)
        : [...current.participantIds, id],
    }));
  }

  async function saveBattle(event) {
    event.preventDefault();
    if (busy || !draft) return;
    setFormError("");
    try {
      const snapshots = new Map(
        draftParticipants.map((participant) => [participant.id, participant]),
      );
      const candidate = {
        ...draft,
        dungeon: draft.dungeon.trim(),
        durationMinutes:
          draft.durationMinutes === "" ? null : Number(draft.durationMinutes),
        participants: draft.participantIds.map((id) => {
          const participant = snapshots.get(id);
          return {
            id,
            name: participant?.name || "이름 미상",
            class: participant?.class || "",
          };
        }),
        updatedAt: new Date().toISOString(),
      };
      const checked = validateBattle(candidate, members);
      setSaving(true);
      const success = await onSave({
        ...data,
        battles: [
          ...battles.filter((battle) => battle.id !== checked.id),
          checked,
        ],
      });
      if (success) setDraft(null);
      else
        setFormError(
          "저장하지 못했습니다. 오류 메시지를 확인한 뒤 다시 시도해 주세요.",
        );
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeBattle(battle) {
    if (busy || !window.confirm(`‘${battle.dungeon}’ 전투 기록을 삭제할까요?`))
      return;
    setSaving(true);
    setListError("");
    try {
      await onSave({
        ...data,
        battles: battles.filter((entry) => entry.id !== battle.id),
      });
    } catch (error) {
      setListError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="dungeon-root" aria-labelledby="dungeon-heading">
      <div className="dungeon-page-heading">
        <div>
          <p className="dungeon-eyebrow">BATTLE ARCHIVE</p>
          <h1 id="dungeon-heading">던전 전투</h1>
          <p className="dungeon-subtitle">
            함께한 혈맹원과 전투의 결과를 한곳에 기록하세요.
          </p>
        </div>
        <button
          className="dungeon-primary"
          onClick={() => openEditor()}
          disabled={busy}
        >
          <BattleIcon name="plus" size={18} />
          전투 기록 추가
        </button>
      </div>

      <div className="dungeon-stat-grid">
        <article className="dungeon-stat">
          <span className="dungeon-stat-icon">
            <BattleIcon />
          </span>
          <div>
            <span>전체 전투 기록</span>
            <strong>
              {battles.length}
              <small>회</small>
            </strong>
          </div>
        </article>
        <article className="dungeon-stat">
          <span className="dungeon-stat-icon success">
            <BattleIcon name="flag" />
          </span>
          <div>
            <span>성공한 전투</span>
            <strong>
              {completed}
              <small>회</small>
            </strong>
          </div>
        </article>
        <article className="dungeon-stat">
          <span className="dungeon-stat-icon">
            <BattleIcon name="users" />
          </span>
          <div>
            <span>누적 참여 혈맹원</span>
            <strong>
              {totalParticipants}
              <small>명</small>
            </strong>
          </div>
        </article>
      </div>

      <div className="dungeon-records">
        {listError && (
          <p className="dungeon-form-error" role="alert">
            {listError}
          </p>
        )}
        <div className="dungeon-records-header">
          <div>
            <h2>전투 일지</h2>
            <span>최근 전투부터 표시합니다.</span>
          </div>
          <span className="dungeon-count">{visible.length}개 기록</span>
        </div>
        <div className="dungeon-toolbar">
          <label className="dungeon-search">
            <BattleIcon name="search" size={17} />
            <input
              aria-label="전투 기록 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="던전, 참여자, 획득 아이템 검색"
            />
          </label>
          <label className="dungeon-filter">
            <span className="dungeon-sr-only">전투 결과 필터</span>
            <select
              aria-label="전투 결과 필터"
              value={resultFilter}
              onChange={(event) => setResultFilter(event.target.value)}
            >
              <option value="전체">모든 결과</option>
              <option>성공</option>
              <option>실패</option>
              <option>중단</option>
            </select>
          </label>
          <label className="dungeon-filter">
            <span className="dungeon-sr-only">참여 혈맹원 필터</span>
            <select
              aria-label="참여 혈맹원 필터"
              value={memberFilter}
              onChange={(event) => setMemberFilter(event.target.value)}
            >
              <option value="전체">모든 혈맹원</option>
              {knownParticipants.map((member) => (
                <option value={member.id} key={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {visible.length === 0 ? (
          <div className="dungeon-empty">
            <span className="dungeon-empty-icon">
              <BattleIcon size={35} />
            </span>
            <h3>
              {battles.length
                ? "조건에 맞는 전투 기록이 없습니다."
                : "첫 번째 전투를 기록해 보세요."}
            </h3>
            <p>
              {battles.length
                ? "검색어나 필터를 변경해 보세요."
                : "던전과 참여 혈맹원, 전투 결과를 남기면 이곳에 차곡차곡 모입니다."}
            </p>
            {!battles.length && (
              <button
                className="dungeon-secondary"
                onClick={() => openEditor()}
                disabled={busy}
              >
                전투 기록 추가
              </button>
            )}
          </div>
        ) : (
          <div className="dungeon-list">
            {visible.map((battle) => (
              <article className="dungeon-battle" key={battle.id}>
                <div
                  className={`dungeon-battle-mark ${resultStyle[battle.result] || ""}`}
                >
                  <BattleIcon size={23} />
                </div>
                <div className="dungeon-battle-content">
                  <div className="dungeon-battle-top">
                    <div className="dungeon-battle-title">
                      <h3>{battle.dungeon}</h3>
                      <span
                        className={`dungeon-result ${resultStyle[battle.result] || ""}`}
                      >
                        {battle.result}
                      </span>
                    </div>
                    <span className="dungeon-battle-date">
                      {battle.date.replaceAll("-", ".")} {battle.time}
                    </span>
                  </div>
                  <div className="dungeon-battle-meta">
                    <span>
                      <BattleIcon name="users" size={14} />
                      참여 {battle.participantIds?.length || 0}명
                    </span>
                    {battle.durationMinutes > 0 && (
                      <span>
                        <BattleIcon name="clock" size={14} />
                        {battle.durationMinutes}분
                      </span>
                    )}
                  </div>
                  <div className="dungeon-participant-tags">
                    {(battle.participants || []).map((participant) => (
                      <span key={participant.id}>{participant.name}</span>
                    ))}
                  </div>
                  {battle.loot && (
                    <p className="dungeon-loot">
                      <b>획득 아이템</b>
                      {battle.loot}
                    </p>
                  )}
                  {battle.note && (
                    <p className="dungeon-battle-note">{battle.note}</p>
                  )}
                </div>
                <div className="dungeon-row-actions">
                  <button
                    onClick={() => openEditor(battle)}
                    disabled={busy}
                    aria-label={`${battle.dungeon} 전투 기록 수정`}
                  >
                    수정
                  </button>
                  <button
                    onClick={() => removeBattle(battle)}
                    disabled={busy}
                    className="dungeon-delete"
                    aria-label={`${battle.dungeon} 전투 기록 삭제`}
                  >
                    삭제
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <dialog
        className="dungeon-dialog"
        ref={dialog}
        onCancel={(event) => {
          event.preventDefault();
          closeEditor();
        }}
        aria-labelledby="dungeon-dialog-title"
      >
        {draft && (
          <form onSubmit={saveBattle}>
            <div className="dungeon-dialog-heading">
              <div>
                <p className="dungeon-eyebrow">BATTLE RECORD</p>
                <h2 id="dungeon-dialog-title">
                  {editing ? "전투 기록 수정" : "새 전투 기록"}
                </h2>
              </div>
              <button
                className="dungeon-close"
                type="button"
                aria-label="전투 기록 닫기"
                onClick={closeEditor}
                disabled={busy}
              >
                <BattleIcon name="close" />
              </button>
            </div>
            <div className="dungeon-form-content">
              <label className="dungeon-field">
                던전 이름 <span aria-hidden="true">*</span>
                <input
                  autoFocus
                  value={draft.dungeon}
                  onChange={(event) => update("dungeon", event.target.value)}
                  placeholder="전투를 진행한 던전 이름"
                  maxLength={100}
                  required
                />
              </label>
              <div className="dungeon-form-grid">
                <label className="dungeon-field">
                  전투 날짜
                  <input
                    type="date"
                    value={draft.date}
                    onChange={(event) => update("date", event.target.value)}
                    required
                  />
                </label>
                <label className="dungeon-field">
                  전투 시각
                  <input
                    type="time"
                    value={draft.time}
                    onChange={(event) => update("time", event.target.value)}
                    required
                  />
                </label>
              </div>
              <div className="dungeon-form-grid">
                <label className="dungeon-field">
                  전투 결과
                  <select
                    value={draft.result}
                    onChange={(event) => update("result", event.target.value)}
                  >
                    <option>성공</option>
                    <option>실패</option>
                    <option>중단</option>
                  </select>
                </label>
                <label className="dungeon-field">
                  진행 시간 <small>(선택)</small>
                  <div className="dungeon-unit-input">
                    <input
                      type="number"
                      min="0"
                      max="10080"
                      step="1"
                      value={draft.durationMinutes ?? ""}
                      onChange={(event) =>
                        update("durationMinutes", event.target.value)
                      }
                      placeholder="예: 30"
                    />
                    <span>분</span>
                  </div>
                </label>
              </div>
              <fieldset className="dungeon-participant-fieldset">
                <legend>
                  참여 혈맹원 <span>{draft.participantIds.length}명 선택</span>
                </legend>
                <div className="dungeon-participant-tools">
                  <button
                    type="button"
                    onClick={() =>
                      update(
                        "participantIds",
                        draftParticipants.map((member) => member.id),
                      )
                    }
                    disabled={!draftParticipants.length}
                  >
                    전체 선택
                  </button>
                  <button
                    type="button"
                    onClick={() => update("participantIds", [])}
                    disabled={!draft.participantIds.length}
                  >
                    선택 해제
                  </button>
                </div>
                {!draftParticipants.length ? (
                  <p className="dungeon-no-members">
                    등록된 혈맹원이 없습니다. 혈맹원 메뉴에서 먼저 등록해
                    주세요.
                  </p>
                ) : (
                  <div className="dungeon-member-picker">
                    {draftParticipants.map((member) => (
                      <label
                        key={member.id}
                        className={
                          draft.participantIds.includes(member.id)
                            ? "selected"
                            : ""
                        }
                      >
                        <input
                          type="checkbox"
                          checked={draft.participantIds.includes(member.id)}
                          onChange={() => toggleParticipant(member.id)}
                        />
                        <span>
                          <b>{member.name}</b>
                          <small>
                            {member.class || "클래스 미입력"}
                            {member.removed ? " · 현재 명단에 없음" : ""}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <label className="dungeon-field">
                획득 아이템 <small>(선택)</small>
                <input
                  value={draft.loot || ""}
                  onChange={(event) => update("loot", event.target.value)}
                  maxLength={2000}
                  placeholder="획득한 아이템과 수량을 기록하세요."
                />
              </label>
              <label className="dungeon-field">
                전투 메모 <small>(선택)</small>
                <textarea
                  value={draft.note || ""}
                  onChange={(event) => update("note", event.target.value)}
                  rows={3}
                  maxLength={5000}
                  placeholder="공략 내용, 특이 사항, 다음 전투 준비 사항"
                />
              </label>
              {formError && (
                <p className="dungeon-form-error" role="alert">
                  {formError}
                </p>
              )}
            </div>
            <div className="dungeon-dialog-footer">
              <span>참여자 이름은 기록에 함께 보관됩니다.</span>
              <div>
                <button
                  className="dungeon-secondary"
                  type="button"
                  onClick={closeEditor}
                  disabled={busy}
                >
                  취소
                </button>
                <button
                  className="dungeon-primary"
                  type="submit"
                  disabled={busy || !draftParticipants.length}
                >
                  {saving ? "저장 중…" : "전투 기록 저장"}
                </button>
              </div>
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}
