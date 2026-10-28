import React, { useEffect, useMemo, useRef, useState } from "react";
import { storage, isDesktop } from "./storage.js";
import { rankMembers, validateMember } from "./domain.js";
import Dungeon from "./Dungeon.jsx";
import "./styles.css";

const CLASSES = [
  "군주",
  "기사",
  "요정",
  "마법사",
  "다크엘프",
  "용기사",
  "환술사",
  "전사",
  "검사",
  "창기사",
  "성기사",
  "기타",
];
const MENU_ITEMS = [
  { id: "members", name: "혈맹원", caption: "MEMBERS", icon: "members" },
  {
    id: "ranking",
    name: "레벨 랭킹",
    caption: "LEVEL RANKING",
    icon: "ranking",
  },
  {
    id: "dungeon",
    name: "던전 전투",
    caption: "DUNGEON ENTRY",
    icon: "swords",
  },
];

export function Icon({ name, size = 20, ...props }) {
  const paths = {
    members: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    ranking: (
      <>
        <path d="m8 21 4-4 4 4M12 17V11M5 3h14v3a7 7 0 0 1-14 0V3Z" />
        <path d="M5 5H2v1a4 4 0 0 0 4 4M19 5h3v1a4 4 0 0 1-4 4" />
      </>
    ),
    swords: (
      <>
        <path d="m3 3 5 1 11 11-4 4L4 8 3 3Zm0 18 5-1 3-3M21 3l-5 1-3 3m2 8 4 4m-4 2 6-6M3 15l6 6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    arrow: <path d="m8 5 7 7-7 7" />,
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    edit: (
      <>
        <path d="m15 4 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-3-3L6 16l-2 4Z" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    shield: (
      <>
        <path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20h17M7 16v-4m5 4V7m5 9V3" />
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
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] || paths.shield}
    </svg>
  );
}

const number = (value, maximumFractionDigits = 1) =>
  new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(value);
const newId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `member-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function StatCard({ label, value, suffix, description, icon, accent = false }) {
  return (
    <article className={`stat-card ${accent ? "accent" : ""}`}>
      <div className="stat-label">
        <span>{label}</span>
        <Icon name={icon} />
      </div>
      <div className="stat-value">
        {value}
        <small>{suffix}</small>
      </div>
      <p>{description}</p>
    </article>
  );
}

function EmptyState({ icon = "members", title, description, children }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={30} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}

function MemberForm({ member, members, onClose, onSubmit, busy }) {
  const [form, setForm] = useState(
    member || {
      name: "",
      class: "기사",
      level: 1,
      experience: 0,
      role: "혈맹원",
      note: "",
    },
  );
  const [error, setError] = useState("");
  const firstInput = useRef(null);
  useEffect(() => {
    firstInput.current?.focus();
  }, []);
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = before;
    };
  }, [busy, onClose]);
  function change(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const now = new Date().toISOString();
      const candidate = {
        ...form,
        id: member?.id || newId(),
        level: Number(form.level),
        experience: Number(form.experience),
        createdAt: member?.createdAt || now,
        updatedAt: now,
      };
      const checked = validateMember(candidate, members, member?.id);
      if (await onSubmit(checked)) onClose();
    } catch (issue) {
      setError(issue.message);
    }
  }
  const existingClass =
    form.class && !CLASSES.includes(form.class) ? [form.class] : [];
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal-card member-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-dialog-title"
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">CLAN MEMBER</span>
            <h2 id="member-dialog-title">
              {member ? "혈맹원 수정" : "혈맹원 등록"}
            </h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="닫기"
            onClick={onClose}
            disabled={busy}
          >
            <Icon name="close" />
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="modal-form-body">
            <p className="form-intro">
              캐릭터 정보를 등록하면 레벨 랭킹에 자동으로 반영됩니다.
            </p>
            <label className="field">
              캐릭터명<span className="required">*</span>
              <input
                ref={firstInput}
                name="name"
                required
                maxLength={40}
                autoComplete="off"
                placeholder="캐릭터명을 입력하세요"
                value={form.name}
                onChange={(event) => change("name", event.target.value)}
              />
            </label>
            <div className="field-row">
              <label className="field">
                클래스
                <select
                  value={form.class}
                  onChange={(event) => change("class", event.target.value)}
                >
                  {[...existingClass, ...CLASSES].map((entry) => (
                    <option key={entry}>{entry}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                직책
                <select
                  value={form.role}
                  onChange={(event) => change("role", event.target.value)}
                >
                  {[
                    ...new Set([
                      form.role,
                      "혈맹원",
                      "군주",
                      "부군주",
                      "수호기사",
                      "정예",
                    ]),
                  ]
                    .filter(Boolean)
                    .map((entry) => (
                      <option key={entry}>{entry}</option>
                    ))}
                </select>
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                레벨<span className="required">*</span>
                <input
                  type="number"
                  min="1"
                  max="200"
                  step="1"
                  required
                  value={form.level}
                  onChange={(event) => change("level", event.target.value)}
                />
                <small>1~200 사이의 레벨</small>
              </label>
              <label className="field">
                경험치 (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.001"
                  required
                  value={form.experience}
                  onChange={(event) => change("experience", event.target.value)}
                />
                <small>같은 레벨은 경험치 순으로 정렬</small>
              </label>
            </div>
            <label className="field">
              메모
              <textarea
                rows="3"
                maxLength={2000}
                placeholder="접속 시간, 특이사항 등을 자유롭게 기록하세요"
                value={form.note || ""}
                onChange={(event) => change("note", event.target.value)}
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <button
              className="button ghost"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              취소
            </button>
            <button className="button primary" type="submit" disabled={busy}>
              <Icon name="check" size={17} />
              {busy ? "저장 중…" : member ? "수정 저장" : "혈맹원 등록"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function Members({ members, rankings, busy, onEdit, onAdd, onDelete }) {
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const filtered = members.filter(
    (member) =>
      `${member.name} ${member.role || ""} ${member.note || ""}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()) &&
      (!classFilter || member.class === classFilter),
  );
  const average = members.length
    ? members.reduce((sum, member) => sum + Number(member.level || 0), 0) /
      members.length
    : 0;
  const highest = rankings[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CLAN MEMBERS</span>
          <h1>혈맹원</h1>
          <p>함께하는 혈맹원들의 정보와 성장을 기록하세요.</p>
        </div>
        <button className="button primary" onClick={onAdd} disabled={busy}>
          <Icon name="plus" size={19} />
          혈맹원 등록
        </button>
      </div>
      <div className="stats-grid">
        <StatCard
          label="전체 혈맹원"
          value={number(members.length)}
          suffix="명"
          description="우리 혈맹에 등록된 캐릭터"
          icon="members"
          accent
        />
        <StatCard
          label="평균 레벨"
          value={members.length ? number(average) : "—"}
          suffix="Lv."
          description="등록된 전체 혈맹원 기준"
          icon="chart"
        />
        <StatCard
          label="최고 레벨"
          value={highest ? highest.level : "—"}
          suffix="Lv."
          description={
            highest
              ? `${highest.name} · ${highest.class}`
              : "첫 혈맹원을 등록해 보세요"
          }
          icon="ranking"
        />
      </div>
      <section className="panel roster-panel">
        <div className="panel-heading">
          <div className="panel-title">
            <span className="section-mark" />
            <h2>혈맹원 목록</h2>
            <span className="count-badge">{members.length}</span>
          </div>
          <span className="muted-text">수정한 정보는 PC에 저장됩니다</span>
        </div>
        <div className="table-toolbar">
          <label className="search-field">
            <Icon name="search" size={18} />
            <input
              aria-label="혈맹원 검색"
              placeholder="캐릭터명, 직책, 메모 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                className="icon-button tiny"
                type="button"
                onClick={() => setQuery("")}
                aria-label="검색 초기화"
              >
                <Icon name="close" size={15} />
              </button>
            )}
          </label>
          <select
            className="filter-select"
            aria-label="클래스 필터"
            value={classFilter}
            onChange={(event) => setClassFilter(event.target.value)}
          >
            <option value="">전체 클래스</option>
            {[...new Set(members.map((member) => member.class))]
              .sort()
              .map((entry) => (
                <option key={entry}>{entry}</option>
              ))}
          </select>
        </div>
        {!members.length ? (
          <EmptyState
            title="아직 등록된 혈맹원이 없습니다"
            description="첫 번째 혈맹원을 등록하고 우리 혈맹의 기록을 시작하세요."
          >
            <button className="button outline" onClick={onAdd} disabled={busy}>
              <Icon name="plus" size={17} />
              혈맹원 등록
            </button>
          </EmptyState>
        ) : !filtered.length ? (
          <EmptyState
            icon="search"
            title="검색 결과가 없습니다"
            description="다른 캐릭터명으로 검색하거나 클래스 필터를 변경해 주세요."
          />
        ) : (
          <div className="table-scroll">
            <table className="member-table">
              <thead>
                <tr>
                  <th>캐릭터</th>
                  <th>클래스</th>
                  <th>레벨 / 경험치</th>
                  <th>직책</th>
                  <th>메모</th>
                  <th className="align-right">관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div className="member-identity">
                        <div
                          className={`member-avatar class-${CLASSES.indexOf(member.class) % 4}`}
                        >
                          {member.name?.slice(0, 1)}
                        </div>
                        <div>
                          <strong>{member.name}</strong>
                          <small>혈맹원</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="class-badge">{member.class}</span>
                    </td>
                    <td>
                      <div className="level-cell">
                        <strong>
                          <span>Lv.</span> {member.level}
                        </strong>
                        <span>{number(member.experience || 0, 3)}%</span>
                        <div className="mini-progress">
                          <i
                            style={{
                              width: `${Math.min(100, Math.max(0, member.experience || 0))}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={
                          member.role === "군주" ? "role-owner" : "role-label"
                        }
                      >
                        {member.role || "혈맹원"}
                      </span>
                    </td>
                    <td>
                      <span className="table-note" title={member.note || ""}>
                        {member.note || "—"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label={`${member.name} 수정`}
                          title="수정"
                          onClick={() => onEdit(member)}
                          disabled={busy}
                        >
                          <Icon name="edit" size={17} />
                        </button>
                        <button
                          className="icon-button danger"
                          aria-label={`${member.name} 삭제`}
                          title="삭제"
                          onClick={() => onDelete(member)}
                          disabled={busy}
                        >
                          <Icon name="trash" size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="panel-footer">
          <span>
            총 <b>{filtered.length}</b>명의 혈맹원
          </span>
          <span>
            <span className="tiny-dot" />
            로컬 저장
          </span>
        </footer>
      </section>
      <div className="note-strip">
        <Icon name="shield" size={19} />
        <p>
          입력한 자료는 이 기기에 보관됩니다. 중요한 기록은 상단의{" "}
          <strong>자료 백업</strong>으로 별도 보관하세요.
        </p>
      </div>
    </>
  );
}

function Ranking({ rankings, members, onEdit, busy, onMembers }) {
  const [classFilter, setClassFilter] = useState("");
  const filtered = rankings.filter(
    (member) => !classFilter || member.class === classFilter,
  );
  const maxLevel = Math.max(1, ...filtered.map((member) => member.level));
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">LEVEL RANKING</span>
          <h1>레벨 랭킹</h1>
          <p>
            혈맹의 성장을 한눈에. 레벨과 경험치를 기준으로 순위를 확인하세요.
          </p>
        </div>
        <div className="heading-note">
          <Icon name="clock" size={16} />
          혈맹원 정보와 연동
        </div>
      </div>
      {!rankings.length ? (
        <section className="panel">
          <EmptyState
            icon="ranking"
            title="첫 번째 순위의 주인공을 기다립니다"
            description="혈맹원을 등록하면 레벨과 경험치에 따라 랭킹이 자동으로 만들어집니다."
          >
            <button className="button primary" onClick={onMembers}>
              <Icon name="members" size={17} />
              혈맹원 관리로 이동
            </button>
          </EmptyState>
        </section>
      ) : (
        <>
          <div className="podium-grid">
            {rankings.slice(0, 3).map((member, index) => (
              <article
                key={member.id}
                className={`podium-card podium-${index + 1}`}
              >
                <span className="podium-kicker">
                  {index === 0 ? "TOP RANKER" : "CLAN RANKER"}
                </span>
                <span className="podium-rank">
                  <Icon name="ranking" size={22} />
                  {member.rank}
                  <small>위</small>
                </span>
                <div className="podium-member">{member.name}</div>
                <span className="class-badge">{member.class}</span>
                <div className="podium-level">
                  Lv. <strong>{member.level}</strong>
                  <span>{number(member.experience || 0, 3)}%</span>
                </div>
              </article>
            ))}
          </div>
          <div className="ranking-layout">
            <section className="panel ranking-list-panel">
              <div className="panel-heading">
                <div className="panel-title">
                  <span className="section-mark" />
                  <h2>전체 랭킹</h2>
                  <span className="count-badge">{filtered.length}</span>
                </div>
                <select
                  className="filter-select"
                  aria-label="랭킹 클래스 필터"
                  value={classFilter}
                  onChange={(event) => setClassFilter(event.target.value)}
                >
                  <option value="">전체 클래스</option>
                  {[...new Set(members.map((member) => member.class))]
                    .sort()
                    .map((entry) => (
                      <option key={entry}>{entry}</option>
                    ))}
                </select>
              </div>
              <div className="table-scroll">
                <table className="ranking-table">
                  <thead>
                    <tr>
                      <th>순위</th>
                      <th>캐릭터</th>
                      <th>레벨</th>
                      <th>경험치</th>
                      <th className="align-right">정보</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((member) => (
                      <tr key={member.id}>
                        <td>
                          <span
                            className={`rank-number ${member.rank <= 3 ? `top-${member.rank}` : ""}`}
                          >
                            {member.rank}
                          </span>
                        </td>
                        <td>
                          <strong className="rank-name">{member.name}</strong>
                          <small className="rank-class">{member.class}</small>
                        </td>
                        <td>
                          <span className="level-chip">Lv. {member.level}</span>
                        </td>
                        <td>
                          <span className="experience-text">
                            {number(member.experience || 0, 3)}%
                          </span>
                        </td>
                        <td className="align-right">
                          <button
                            className="icon-button"
                            title="혈맹원 정보 수정"
                            aria-label={`${member.name} 정보 수정`}
                            disabled={busy}
                            onClick={() => onEdit(member)}
                          >
                            <Icon name="edit" size={17} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel-footer">
                <span>레벨 → 경험치 순 · 동률은 공동 순위</span>
              </div>
            </section>
            <aside className="panel growth-panel">
              <div className="panel-heading">
                <div className="panel-title">
                  <Icon name="chart" size={18} />
                  <h2>상위 레벨 분포</h2>
                </div>
              </div>
              <div className="level-bars">
                {filtered.slice(0, 5).map((member, index) => (
                  <div className="level-bar-row" key={member.id}>
                    <div>
                      <span>
                        <small>{index + 1}</small>
                        {member.name}
                      </span>
                      <strong>{member.level}</strong>
                    </div>
                    <div className="level-bar-track">
                      <i
                        style={{ width: `${(member.level / maxLevel) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="ranking-tip">
                <Icon name="shield" size={20} />
                <strong>함께 성장하는 혈맹</strong>
                <p>
                  레벨이나 경험치를 수정하면
                  <br />
                  순위도 함께 갱신됩니다.
                </p>
              </div>
            </aside>
          </div>
        </>
      )}
    </>
  );
}

export default function App() {
  const [menu, setMenu] = useState("members");
  const [data, setData] = useState({ members: [] });
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const rankings = useMemo(() => rankMembers(data.members), [data.members]);
  const activeMenu = MENU_ITEMS.find((item) => item.id === menu);
  async function load() {
    setError("");
    try {
      const result = await storage.load();
      result.data.members.forEach((member) => validateMember(member));
      setData(result.data);
      setRevision(result.revision);
      setLoaded(true);
    } catch (issue) {
      setError(issue.message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);
  async function save(next) {
    if (!loaded || busy) return false;
    setBusy(true);
    setError("");
    try {
      const result = await storage.save(next, revision);
      setData(result.data);
      setRevision(result.revision);
      setLastSaved(new Date());
      setNotice("변경사항을 저장했습니다.");
      return true;
    } catch (issue) {
      setError(issue.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function backup() {
    setBusy(true);
    setError("");
    try {
      const result = await storage.exportBackup();
      if (!result.cancelled) setNotice("자료 백업을 내보냈습니다.");
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    setBusy(true);
    setError("");
    try {
      const result = await storage.importBackup(revision);
      if (!result.cancelled) {
        result.data.members.forEach((member) => validateMember(member));
        setData(result.data);
        setRevision(result.revision);
        setLoaded(true);
        setNotice("백업 자료를 불러왔습니다.");
      }
    } catch (issue) {
      setError(issue.message);
    } finally {
      setBusy(false);
    }
  }
  function edit(member) {
    setEditing(member);
    setMemberModalOpen(true);
  }
  async function submitMember(member) {
    const updated = data.members.some((entry) => entry.id === member.id);
    const members = updated
      ? data.members.map((entry) => (entry.id === member.id ? member : entry))
      : [...data.members, member];
    return save({ ...data, members });
  }
  async function deleteMember(member) {
    if (
      !window.confirm(
        `${member.name} 혈맹원을 목록에서 삭제할까요? 전투 기록은 유지됩니다.`,
      )
    )
      return;
    await save({
      ...data,
      members: data.members.filter((entry) => entry.id !== member.id),
    });
  }
  const disabled = busy || !loaded;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setMenu("members");
          }}
        >
          <div className="brand-crest">
            <Icon name="shield" size={30} />
          </div>
          <div>
            <strong>혈맹 관리 도우미</strong>
            <span>LINEAGE CLAN MANAGER</span>
          </div>
        </a>
        <div className="sidebar-divider" />
        <span className="nav-label">혈맹 관리</span>
        <nav aria-label="주 메뉴">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${menu === item.id ? "active" : ""}`}
              aria-current={menu === item.id ? "page" : undefined}
              onClick={() => setMenu(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.name}</span>
              {menu === item.id && <Icon name="arrow" size={14} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="sidebar-note-symbol">L</div>
          <span>
            우리 혈맹의 이야기를
            <br />
            한곳에 기록하세요.
          </span>
          <p>
            혈맹원부터 전투의 순간까지,
            <br />내 PC에서 편리하게 관리합니다.
          </p>
        </div>
        <div className="sidebar-bottom">
          <span>
            <i />
            {isDesktop ? "독립 실행 프로그램" : "브라우저 저장 모드"}
          </span>
          <small>VERSION 1.1.0</small>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            혈맹 관리
            <Icon name="arrow" size={13} />
            <strong>{activeMenu.name}</strong>
          </div>
          <div className="topbar-actions">
            <span className="local-status">
              <span className="tiny-dot" />
              {busy ? "자료 처리 중" : "내 PC에 저장"}
            </span>
            <span className="topbar-separator" />
            <button
              className="topbar-button"
              onClick={backup}
              disabled={disabled}
            >
              <Icon name="download" size={16} />
              <span>자료 백업</span>
            </button>
            <button className="topbar-button" onClick={restore} disabled={busy}>
              <Icon name="upload" size={16} />
              <span>백업 불러오기</span>
            </button>
          </div>
        </header>
        <main className="main-content">
          {error && (
            <div className="alert error-alert" role="alert">
              <div>
                <strong>자료를 처리하지 못했습니다</strong>
                <p>{error}</p>
              </div>
              <button
                className="button outline small"
                onClick={load}
                disabled={busy}
              >
                다시 불러오기
              </button>
            </div>
          )}
          {!loaded ? (
            <section className="panel">
              <EmptyState
                icon="shield"
                title={
                  error
                    ? "저장된 자료를 확인해 주세요"
                    : "혈맹 자료를 불러오고 있습니다"
                }
                description={
                  error
                    ? "기존 자료를 삭제하지 않았습니다. 다시 불러오거나 보관한 백업을 확인해 주세요."
                    : "잠시만 기다려 주세요."
                }
              />
            </section>
          ) : menu === "members" ? (
            <Members
              members={data.members}
              rankings={rankings}
              busy={disabled}
              onAdd={() => {
                setEditing(null);
                setMemberModalOpen(true);
              }}
              onEdit={edit}
              onDelete={deleteMember}
            />
          ) : menu === "ranking" ? (
            <Ranking
              rankings={rankings}
              members={data.members}
              busy={disabled}
              onEdit={edit}
              onMembers={() => setMenu("members")}
            />
          ) : (
            <Dungeon
              members={data.members}
              data={data}
              onSave={save}
              disabled={disabled}
            />
          )}
          <footer className="app-footer">
            <span>
              LINEAGE CLAN MANAGER<span className="footer-dot">·</span>우리
              혈맹만의 기록
            </span>
            <span>
              {lastSaved
                ? `${lastSaved.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 저장됨`
                : "자동 저장 · 로컬 데이터"}
            </span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <span>
            <Icon name="check" size={16} />
          </span>
          {notice}
        </div>
      )}
      {memberModalOpen && (
        <MemberForm
          member={editing}
          members={data.members}
          onClose={() => setMemberModalOpen(false)}
          onSubmit={submitMember}
          busy={busy}
        />
      )}
    </div>
  );
}
