import React, { useEffect, useMemo, useRef, useState } from "react";
import { CLASSES, rankMembers } from "./domain.js";
import entryLogic from "../lib/entry.cjs";
import { copyEntryText } from "./clipboard.js";
import "./Dungeon.css";

const ENTRY_SIZE = 15;

function initialSettings(value) {
  return {
    mode: value?.mode === "class" ? "class" : "ranking",
    classQuotas: { ...(value?.classQuotas || {}) },
    absentIds: [...(value?.absentIds || [])],
  };
}

function settingsKey(settings) {
  return JSON.stringify({
    mode: settings.mode,
    classQuotas: Object.entries(settings.classQuotas || {})
      .filter(([, count]) => Number(count) !== 0)
      .sort(([a], [b]) => a.localeCompare(b, "ko")),
    absentIds: [...(settings.absentIds || [])].sort(),
  });
}

function EntryIcon({ name = "swords", size = 20 }) {
  const paths = {
    swords: (
      <>
        <path d="m4 3 17 17M3 3l1 6 5-5-6-1ZM15 16l-2 2M16 15l2-2M20 3 3 20M21 3l-1 6-5-5 6-1ZM8 15l3 3M6 17l-2-2" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5" />
      </>
    ),
    crown: (
      <>
        <path d="m3 6 4 4 5-6 5 6 4-4-2 13H5L3 6ZM6 22h12" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    save: (
      <>
        <path d="M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    minus: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M7 12h10" />
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

function memberSnapshot(member) {
  return {
    id: member.id,
    name: member.name,
    class: member.class,
    level: member.level,
    experience: member.experience,
    rank: member.rank,
  };
}

function formatPercent(value) {
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 3 });
}

export default function Dungeon({
  members = [],
  data = {},
  onSave,
  disabled = false,
}) {
  const [settings, setSettings] = useState(() =>
    initialSettings(data.entrySettings),
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const lastPersisted = useRef(
    settingsKey(initialSettings(data.entrySettings)),
  );
  const pendingPersisted = useRef(null);
  const busy = disabled || saving;
  const persisted = initialSettings(data.entrySettings);

  useEffect(() => {
    const next = initialSettings(data.entrySettings);
    const key = settingsKey(next);
    if (key === lastPersisted.current) return;
    lastPersisted.current = key;
    if (pendingPersisted.current === key) {
      pendingPersisted.current = null;
      return;
    }
    setSettings(next);
    setMessage("");
    setError("");
  }, [data.entrySettings]);

  const ranked = useMemo(() => rankMembers(members), [members]);
  const absentSet = useMemo(
    () => new Set(settings.absentIds),
    [settings.absentIds],
  );
  const selectedAbsentees = ranked.filter((member) => absentSet.has(member.id));
  const available = ranked.filter((member) => !absentSet.has(member.id));
  const classes = useMemo(
    () => [
      ...new Set([
        ...CLASSES,
        ...members.map((member) => member.class),
        ...Object.keys(settings.classQuotas),
      ]),
    ],
    [members, settings.classQuotas],
  );
  const quotaTotal = Object.values(settings.classQuotas).reduce(
    (sum, count) => sum + Number(count || 0),
    0,
  );
  const quotaInputsValid = Object.values(settings.classQuotas).every(
    (count) => Number.isInteger(count) && count >= 0 && count <= ENTRY_SIZE,
  );
  const quotasValid = quotaInputsValid && quotaTotal === ENTRY_SIZE;
  const settingsDirty = settingsKey(settings) !== settingsKey(persisted);
  const selection = useMemo(() => {
    try {
      return { ...entryLogic.selectEntry(members, settings), error: "" };
    } catch (issue) {
      return {
        members: [],
        shortages: [],
        vacancies: ENTRY_SIZE,
        error: issue.message,
      };
    }
  }, [members, settings]);
  const selected = selection.members || [];
  const selectedIds = new Set(selected.map((member) => member.id));
  const complete = !selection.error && selected.length === ENTRY_SIZE;
  const confirmed = Boolean(
    data.finalEntry &&
    complete &&
    settingsKey(data.finalEntry.settings) === settingsKey(settings) &&
    JSON.stringify(data.finalEntry.members.map(memberSnapshot)) ===
      JSON.stringify(selected.map(memberSnapshot)),
  );
  const finalText = confirmed
    ? entryLogic.formatEntryText(data.finalEntry.members)
    : "";
  const visible = ranked.filter(
    (member) =>
      !query.trim() ||
      `${member.name} ${member.class}`
        .toLocaleLowerCase("ko")
        .includes(query.trim().toLocaleLowerCase("ko")),
  );

  async function persist(nextSettings, finalEntry) {
    setSaving(true);
    setError("");
    setMessage("");
    pendingPersisted.current = settingsKey(nextSettings);
    try {
      const next = { ...data, entrySettings: nextSettings };
      if (finalEntry !== undefined) next.finalEntry = finalEntry;
      const saved = await onSave(next);
      if (!saved) {
        pendingPersisted.current = null;
        setError(
          "자료를 저장하지 못했습니다. 상단 오류를 확인한 뒤 다시 시도해 주세요.",
        );
        return false;
      }
      return true;
    } catch (issue) {
      pendingPersisted.current = null;
      setError(issue.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function chooseMode(mode) {
    if (busy || mode === settings.mode) return;
    const next = { ...settings, mode };
    if (mode === "ranking" && !quotasValid) {
      const savedTotal = Object.values(persisted.classQuotas).reduce(
        (sum, count) => sum + count,
        0,
      );
      next.classQuotas =
        savedTotal === ENTRY_SIZE ? { ...persisted.classQuotas } : {};
    }
    setSettings(next);
    setError("");
    setMessage("");
    if (mode === "ranking" || quotasValid) {
      if (await persist(next)) setMessage("선발 방식을 저장했습니다.");
    }
  }

  function changeQuota(className, rawValue) {
    const value = rawValue === "" ? 0 : Number(rawValue);
    setSettings((current) => ({
      ...current,
      classQuotas: { ...current.classQuotas, [className]: value },
    }));
    setMessage("");
    setError("");
  }

  async function saveQuotas() {
    if (!quotasValid || busy) return;
    const next = { ...settings, mode: "class" };
    setSettings(next);
    if (await persist(next))
      setMessage(
        "클래스별 지정 인원을 저장했습니다. 다음 실행에도 유지됩니다.",
      );
  }

  async function updateAbsences(ids) {
    if (busy) return;
    const next = { ...settings, absentIds: ids };
    setSettings(next);
    const currentSettingsValid =
      quotasValid ||
      (settings.mode === "ranking" && quotaInputsValid && quotaTotal === 0);
    const nextPersisted = currentSettingsValid
      ? next
      : { ...persisted, absentIds: ids };
    if (await persist(nextPersisted))
      setMessage(
        "불참자를 저장했습니다. 체크한 혈맹원은 엔트리에서 제외됩니다.",
      );
  }

  async function confirmEntry() {
    if (!complete || busy) return;
    try {
      const finalEntry = {
        confirmedAt: new Date().toISOString(),
        settings: initialSettings(settings),
        members: selected.map(memberSnapshot),
      };
      if (await persist(settings, finalEntry))
        setMessage(
          "15인 엔트리를 확정하고 저장했습니다. 최종 엔트리를 복사해 전달하세요.",
        );
    } catch (issue) {
      setError(issue.message);
    }
  }

  async function copyFinal() {
    if (!confirmed || busy || copying) return;
    setCopying(true);
    setError("");
    try {
      await copyEntryText(finalText);
      setMessage("15인 최종 엔트리를 복사했습니다.");
    } catch (issue) {
      setError(
        issue.message ||
          "복사하지 못했습니다. 전달 문구를 직접 선택해 복사해 주세요.",
      );
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="entry-root">
      <div className="entry-page-heading">
        <div>
          <p className="entry-eyebrow">DUNGEON ENTRY</p>
          <h1>던전 전투</h1>
          <p className="entry-subtitle">
            15인 엔트리 편성 · 불참자를 제외하고 레벨과 경험치 순으로
            선발합니다.
          </p>
        </div>
        <span className="entry-title-badge">
          <EntryIcon name="swords" size={17} /> 15인 출전 명단
        </span>
      </div>

      <div className="entry-stat-grid">
        <div className="entry-stat">
          <span className="entry-stat-icon">
            <EntryIcon name="users" />
          </span>
          <div>
            <span>등록 혈맹원</span>
            <strong>
              {members.length}
              <small>명</small>
            </strong>
          </div>
        </div>
        <div className="entry-stat">
          <span className="entry-stat-icon green">
            <EntryIcon name="check" />
          </span>
          <div>
            <span>참여 가능</span>
            <strong>
              {available.length}
              <small>명</small>
            </strong>
          </div>
        </div>
        <div className="entry-stat">
          <span className="entry-stat-icon red">
            <EntryIcon name="minus" />
          </span>
          <div>
            <span>불참자</span>
            <strong>
              {selectedAbsentees.length}
              <small>명</small>
            </strong>
          </div>
        </div>
        <div className="entry-stat">
          <span className="entry-stat-icon">
            <EntryIcon name="crown" />
          </span>
          <div>
            <span>선발 엔트리</span>
            <strong>
              {selected.length}
              <small>/ 15명</small>
            </strong>
          </div>
        </div>
      </div>

      {error && (
        <div className="entry-alert error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="entry-alert success" role="status">
          {message}
        </div>
      )}

      {!members.length && (
        <section className="entry-empty" aria-label="혈맹원 등록 안내">
          <EntryIcon name="users" size={34} />
          <h2>혈맹원을 먼저 등록해 주세요</h2>
          <p>
            혈맹원 메뉴에서 캐릭터를 등록하면 랭킹을 기준으로 출전 엔트리를
            선발할 수 있습니다.
          </p>
        </section>
      )}

      <div className="entry-layout">
        <div className="entry-setup-column">
          <section className="entry-panel" aria-labelledby="entry-method-title">
            <div className="entry-panel-heading">
              <div>
                <h2 id="entry-method-title">선발 방식</h2>
                <p>우리 혈맹에 맞는 출전 명단을 구성하세요.</p>
              </div>
              <span className="entry-step">01</span>
            </div>
            <div
              className="entry-mode-options"
              role="radiogroup"
              aria-label="엔트리 선발 방식"
            >
              <button
                type="button"
                role="radio"
                aria-label="랭킹 상위 15명"
                aria-checked={settings.mode === "ranking"}
                className={settings.mode === "ranking" ? "active" : ""}
                onClick={() => chooseMode("ranking")}
                disabled={busy}
              >
                <EntryIcon name="crown" />
                <span>
                  <strong>랭킹 상위 15명</strong>
                  <small>참여 가능한 혈맹원 중 상위 순위 선발</small>
                </span>
                <i />
              </button>
              <button
                type="button"
                role="radio"
                aria-label="클래스별 지정 인원"
                aria-checked={settings.mode === "class"}
                className={settings.mode === "class" ? "active" : ""}
                onClick={() => chooseMode("class")}
                disabled={busy}
              >
                <EntryIcon name="users" />
                <span>
                  <strong>클래스별 지정 인원</strong>
                  <small>클래스별 인원 안에서 상위 순위 선발</small>
                </span>
                <i />
              </button>
            </div>
            {settings.mode === "ranking" ? (
              <div className="entry-rule-note">
                <EntryIcon name="check" size={16} />
                <p>
                  레벨 → 경험치 순으로 상위 15명을 선발합니다. 동률은 캐릭터명
                  순으로 정렬하며, 불참자는 제외합니다.
                </p>
              </div>
            ) : (
              <div className="entry-quotas">
                <div className="entry-quota-heading">
                  <h3>클래스별 지정 인원</h3>
                  <span className={quotasValid ? "valid" : "invalid"}>
                    합계 <b>{quotaTotal}</b> / 15명
                  </span>
                </div>
                <div className="entry-quota-grid">
                  {classes.map((className) => {
                    const count = settings.classQuotas[className] || 0;
                    const ready = available.filter(
                      (member) => member.class === className,
                    ).length;
                    return (
                      <label
                        key={className}
                        className={
                          count > ready ? "entry-quota shortage" : "entry-quota"
                        }
                      >
                        <span>{className}</span>
                        <div>
                          <input
                            type="number"
                            min="0"
                            max="15"
                            step="1"
                            aria-label={`${className} 인원`}
                            value={count}
                            onChange={(event) =>
                              changeQuota(className, event.target.value)
                            }
                            disabled={busy}
                          />
                          <small>명</small>
                        </div>
                        <em>참여 가능 {ready}명</em>
                      </label>
                    );
                  })}
                </div>
                <div className="entry-quota-footer">
                  <p>
                    {quotasValid
                      ? "클래스별 지정 인원을 저장할 수 있습니다."
                      : "지정 인원 합계를 정확히 15명으로 맞춰 주세요."}
                  </p>
                  <button
                    className="entry-secondary"
                    type="button"
                    onClick={saveQuotas}
                    disabled={busy || !quotasValid}
                  >
                    <EntryIcon name="save" size={15} />
                    클래스별 인원 저장
                  </button>
                </div>
              </div>
            )}
            {settingsDirty && (
              <p className="entry-unsaved">
                현재 설정은 아직 모두 저장되지 않았습니다. 인원 저장 또는 엔트리
                확정으로 저장하세요.
              </p>
            )}
          </section>

          <section
            className="entry-panel"
            aria-labelledby="entry-absence-title"
          >
            <div className="entry-panel-heading">
              <div>
                <h2 id="entry-absence-title">불참자 제외</h2>
                <p>체크한 혈맹원은 모든 선발 방식에서 제외됩니다.</p>
              </div>
              <span className="entry-step">02</span>
            </div>
            <div className="entry-absence-tools">
              <label className="entry-search">
                <EntryIcon name="search" size={17} />
                <input
                  aria-label="불참자 검색"
                  placeholder="캐릭터명 또는 클래스 검색"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button
                className="entry-text-button"
                type="button"
                disabled={busy || !selectedAbsentees.length}
                onClick={() => updateAbsences([])}
              >
                불참 선택 해제
              </button>
            </div>
            <div className="entry-absence-summary">
              <span>등록 {members.length}명</span>
              <b>불참 {selectedAbsentees.length}명</b>
            </div>
            <div className="entry-member-list">
              {visible.map((member) => (
                <label
                  key={member.id}
                  className={`entry-member-choice ${absentSet.has(member.id) ? "absent" : ""}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`${member.name} 불참`}
                    checked={absentSet.has(member.id)}
                    disabled={busy}
                    onChange={(event) =>
                      updateAbsences(
                        event.target.checked
                          ? [...settings.absentIds, member.id]
                          : settings.absentIds.filter((id) => id !== member.id),
                      )
                    }
                  />
                  <div className="entry-member-identity">
                    <strong>{member.name}</strong>
                    <span>
                      {member.class} · Lv. {member.level} ·{" "}
                      {formatPercent(member.experience)}%
                    </span>
                  </div>
                  <span className="entry-member-state">
                    {absentSet.has(member.id)
                      ? "불참"
                      : selectedIds.has(member.id)
                        ? "선발"
                        : "대기"}
                  </span>
                </label>
              ))}
              {!visible.length && (
                <p className="entry-list-empty">
                  {members.length
                    ? "검색 결과가 없습니다."
                    : "등록된 혈맹원이 없습니다."}
                </p>
              )}
            </div>
            <p className="entry-small-note">
              불참 체크는 자동 저장됩니다. 참가할 수 있게 되면 체크를
              해제하세요.
            </p>
          </section>
        </div>

        <section
          className="entry-panel entry-result-panel"
          aria-labelledby="entry-result-title"
        >
          <div className="entry-panel-heading">
            <div>
              <h2 id="entry-result-title">
                선발 엔트리 <span>{selected.length} / 15명</span>
              </h2>
              <p>
                {settings.mode === "ranking"
                  ? "참여 가능 혈맹원의 랭킹 상위 명단"
                  : "클래스별 지정 인원을 반영한 상위 명단"}
              </p>
            </div>
            <span className="entry-step">03</span>
          </div>
          {(selection.error || !complete) && (
            <div className="entry-shortage" role="status">
              <strong>
                {selection.error ||
                  `정원 15명 중 ${selected.length}명 선발 · ${15 - selected.length}명 부족`}
              </strong>
              {(selection.shortages || []).length > 0 && (
                <ul>
                  {selection.shortages.map((shortage) => (
                    <li key={shortage.class}>
                      {shortage.class} {shortage.required}명 중{" "}
                      {shortage.available}명 참여 가능 — {shortage.missing}명
                      부족
                    </li>
                  ))}
                </ul>
              )}
              <p>15명을 모두 선발한 뒤 최종 엔트리를 확정할 수 있습니다.</p>
            </div>
          )}
          <div className="entry-table-scroll">
            <table className="entry-table" aria-label="선발 엔트리">
              <thead>
                <tr>
                  <th scope="col">순번</th>
                  <th scope="col">캐릭터</th>
                  <th scope="col">클래스</th>
                  <th scope="col">레벨 / 경험치</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((member, index) => (
                  <tr key={member.id}>
                    <td>
                      <span className={`entry-slot ${index < 3 ? "top" : ""}`}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </td>
                    <td>
                      <strong>{member.name}</strong>
                    </td>
                    <td>
                      <span className="entry-class-chip">{member.class}</span>
                    </td>
                    <td>
                      <b>Lv. {member.level}</b>
                      <small>{formatPercent(member.experience)}%</small>
                    </td>
                  </tr>
                ))}
                {!selected.length && (
                  <tr>
                    <td colSpan="4" className="entry-result-empty">
                      <EntryIcon name="swords" size={30} />
                      <span>
                        {members.length
                          ? "선발 조건을 확인해 주세요."
                          : "등록된 혈맹원으로 엔트리가 만들어집니다."}
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="entry-confirm-area">
            <div
              className={`entry-confirm-status ${confirmed ? "confirmed" : ""}`}
            >
              <EntryIcon name={confirmed ? "check" : "save"} size={16} />
              <span>
                {confirmed
                  ? "최종 엔트리가 확정·저장되었습니다."
                  : data.finalEntry
                    ? "명단이나 설정이 변경됐습니다. 엔트리를 다시 확정해 주세요."
                    : "명단을 확인한 뒤 15인 엔트리를 확정하세요."}
              </span>
            </div>
            <button
              type="button"
              className="entry-primary"
              onClick={confirmEntry}
              disabled={busy || !complete}
            >
              <EntryIcon name="check" size={17} />
              엔트리 확정·저장
            </button>
          </div>
          <div className="entry-copy-area">
            <div>
              <h3>최종 엔트리 전달</h3>
              <p>복사한 명단을 메신저나 게시판에 붙여넣어 전달하세요.</p>
            </div>
            <textarea
              aria-label="최종 엔트리 전달 문구"
              readOnly
              value={finalText}
              placeholder="엔트리를 확정하면 전달할 최종 명단이 표시됩니다."
              rows={8}
            />
            <button
              type="button"
              className="entry-primary"
              disabled={busy || copying || !confirmed}
              onClick={copyFinal}
            >
              <EntryIcon name="copy" size={17} />
              {copying ? "복사 중…" : "최종 엔트리 복사"}
            </button>
            <small>
              불참자·클래스 인원·혈맹원 정보가 바뀌면 다시 확정해야 복사할 수
              있습니다.
            </small>
          </div>
        </section>
      </div>
    </div>
  );
}
