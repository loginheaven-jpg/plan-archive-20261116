"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Share2,
  Monitor,
  Type,
  Link2,
  Printer,
  Copy,
  History,
  Settings,
  Trash2,
  ArrowRight,
  LogIn,
  Menu,
  RefreshCw,
  X,
  BookOpen,
  MapPin,
  Check,
  Ban,
} from "lucide-react";
import type {
  Bootstrap,
  CalendarEvent,
  ChangeRecord,
  EventInput,
  Occurrence,
  OrganizationId,
} from "@/domain/types";
import { ORGANIZATIONS, organization } from "@/domain/organizations";
import {
  addDaysISO,
  dateClickAction,
  dateLabel,
  expandEvents,
  filterOccurrences,
  occurrencesOnDate,
  occurrenceForDate,
  timeLabel,
  todayKST,
} from "@/domain/calendar";
import { churchYear, DEFAULT_CHURCH_SETTINGS } from "@/domain/church-year";
import { canCreate, canEditEvent, canReadEvent } from "@/domain/permissions";
import { AgendaView, MonthView, YearView } from "./CalendarViews";
import DepartmentFilter from "./DepartmentFilter";
import Dialog from "./Dialog";
import EventEditor, { type EditScope } from "./EventEditor";
import EventDetail, { fieldNames, kindNames, stamp } from "./EventDetail";
import { api } from "./api";

type View = "year" | "month" | "list";
type EditorState = {
  date: string;
  event?: CalendarEvent | Occurrence;
  scope: EditScope;
};
export default function CalendarApp({
  publicMode = false,
}: {
  publicMode?: boolean;
}) {
  const today = todayKST();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1);
  const [view, setView] = useState<View>("month");
  const [selected, setSelected] = useState<OrganizationId[]>(
    ORGANIZATIONS.map((o) => o.id),
  );
  const [includeAll, setIncludeAll] = useState(false);
  const [showChurch, setShowChurch] = useState(true);
  const [large, setLarge] = useState(false);
  const [query, setQuery] = useState("");
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const [detail, setDetail] = useState<Occurrence | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [emptyDate, setEmptyDate] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [churchOpen, setChurchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [changes, setChanges] = useState<ChangeRecord[]>([]);
  const [changesError, setChangesError] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<CalendarEvent[]>([]);
  const [action, setAction] = useState<{
    event: Occurrence;
    kind: "cancel" | "delete";
    scope: EditScope;
  } | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");
  const [prefsReady, setPrefsReady] = useState(false);
  const actor = publicMode ? null : (boot?.actor ?? null);
  const mayCreate = !publicMode && canCreate(actor);
  const bootstrapURL = `/api/bootstrap?year=${year}${publicMode ? "&public=1" : ""}`;
  const reload = useCallback(async () => {
    const data = await api<Bootstrap>(bootstrapURL);
    setBoot(data);
    setLoadError("");
    return data;
  }, [bootstrapURL]);
  useEffect(() => {
    let active = true;
    api<Bootstrap>(bootstrapURL)
      .then((data) => {
        if (active) {
          setBoot(data);
          setLoadError("");
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setLoadError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [bootstrapURL]);
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const prefs = JSON.parse(
          localStorage.getItem("yebom-calendar-preferences") ?? "null",
        ) as {
          selected?: OrganizationId[];
          includeAll?: boolean;
          large?: boolean;
          showChurch?: boolean;
        } | null;
        if (prefs?.selected)
          setSelected(
            prefs.selected.filter((id) =>
              ORGANIZATIONS.some((o) => o.id === id),
            ),
          );
        if (prefs) {
          setIncludeAll(prefs.includeAll === true);
          setLarge(prefs.large === true);
          setShowChurch(prefs.showChurch !== false);
        }
      } catch {
        /* A corrupt preference must not block server data. */
      }
      if (window.matchMedia("(max-width: 760px)").matches) setView("list");
      const params = new URLSearchParams(window.location.search);
      if (params.has("org"))
        setSelected(
          (params.get("org") ?? "")
            .split(",")
            .filter((id) =>
              ORGANIZATIONS.some((o) => o.id === id),
            ) as OrganizationId[],
        );
      if (params.has("all")) setIncludeAll(params.get("all") === "1");
      if (["year", "month", "list"].includes(params.get("view") ?? ""))
        setView(params.get("view") as View);
      const urlYear = Number(params.get("year"));
      const urlMonth = Number(params.get("month"));
      if (
        params.has("year") &&
        Number.isInteger(urlYear) &&
        urlYear >= 2000 &&
        urlYear <= 2100
      )
        setYear(urlYear);
      if (
        params.has("month") &&
        Number.isInteger(urlMonth) &&
        urlMonth >= 1 &&
        urlMonth <= 12
      )
        setMonth(urlMonth - 1);
      setPrefsReady(true);
    });
  }, []);
  useEffect(() => {
    if (prefsReady) {
      try {
        localStorage.setItem(
          "yebom-calendar-preferences",
          JSON.stringify({ selected, includeAll, large, showChurch }),
        );
      } catch {
        /* preferences only */
      }
    }
  }, [selected, includeAll, large, showChurch, prefsReady]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const allOccurrences = useMemo(
    () =>
      expandEvents(boot?.events ?? [], `${year}-01-01`, `${year}-12-31`).filter(
        (e) => canReadEvent(e, actor),
      ),
    [boot?.events, year, actor],
  );
  const filter = useMemo(
    () => ({ selectedIds: selected, query, includeAllAudience: includeAll }),
    [selected, query, includeAll],
  );
  const visible = useMemo(
    () => filterOccurrences(allOccurrences, filter),
    [allOccurrences, filter],
  );
  const days = useMemo(
    () =>
      showChurch
        ? churchYear(year, boot?.settings ?? DEFAULT_CHURCH_SETTINGS)
        : [],
    [year, boot?.settings, showChurch],
  );
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthEvents = visible.filter(
    (e) =>
      e.startDate <= `${monthPrefix}-31` && e.endDate >= `${monthPrefix}-01`,
  );
  const agendaEvents = focusedDate
    ? occurrencesOnDate(visible, focusedDate)
    : view === "year"
      ? visible
      : monthEvents;
  const upcoming = filterOccurrences(
    (boot?.upcoming ?? []).filter((e) => canReadEvent(e, actor)),
    filter,
  ).slice(0, 5);
  const nextChurch = churchYear(
    Number(today.slice(0, 4)),
    boot?.settings ?? DEFAULT_CHURCH_SETTINGS,
  ).find((day) => day.date >= today);
  const openEditor = (date = today) => {
    if (mayCreate) setEditor({ date, scope: "series" });
    else setAuthOpen(true);
  };
  const onDate = (date: string) => {
    const decision = dateClickAction(visible, date, mayCreate);
    if (decision.type === "detail") setDetail(decision.occurrence);
    else if (decision.type === "list") {
      setFocusedDate(date);
      setView("list");
    } else if (decision.type === "create") openEditor(date);
    else setEmptyDate(date);
  };
  const shift = (step: number) => {
    setFocusedDate(null);
    if (view === "year")
      setYear((y) => Math.min(2100, Math.max(2000, y + step)));
    else {
      const date = new Date(Date.UTC(year, month + step, 1));
      const y = date.getUTCFullYear();
      if (y >= 2000 && y <= 2100) {
        setYear(y);
        setMonth(date.getUTCMonth());
      }
    }
  };
  const save = async (
    input: EventInput,
    operationId: string,
    reason: string,
  ) => {
    const response = editor?.event
      ? await api<{ event: CalendarEvent; warnings: string[] }>(
          `/api/events/${editor.event.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              version: editor.event.version,
              action: "update",
              input,
              reason,
              ...(editor.scope === "single" && "recurrenceDate" in editor.event
                ? { occurrenceDate: editor.event.recurrenceDate }
                : {}),
            }),
          },
        )
      : await api<{ event: CalendarEvent; warnings: string[] }>("/api/events", {
          method: "POST",
          body: JSON.stringify({ operationId, input }),
        });
    setDetail(null);
    setBoot((previous) =>
      previous
        ? {
            ...previous,
            events: [
              ...previous.events.filter((e) => e.id !== response.event.id),
              response.event,
            ],
          }
        : previous,
    );
    try {
      await reload();
      setToast(
        response.warnings.length
          ? `저장했어요. ${response.warnings.join(" ")}`
          : "일정을 저장했어요. 수립·변경 기록도 함께 보관했어요.",
      );
    } catch (e) {
      setToast(
        `저장은 완료됐지만 최신 목록 조회는 실패했어요. ${e instanceof Error ? e.message : "새로고침해 주세요."}`,
      );
    }
  };
  const edit = (scope: EditScope) => {
    if (!detail || !canEditEvent(detail, actor)) return;
    const event =
      scope === "series"
        ? (boot?.events.find((e) => e.id === detail.id) ?? detail)
        : detail;
    setEditor({ date: event.startDate, event, scope });
    setDetail(null);
  };
  const beginAction = (kind: "cancel" | "delete") => {
    if (detail) {
      setAction({
        event: detail,
        kind,
        scope: detail.recurrence && kind === "cancel" ? "single" : "series",
      });
      setActionReason("");
      setActionError("");
      setDetail(null);
    }
  };
  const submitAction = async () => {
    if (!action) return;
    setActionPending(true);
    setActionError("");
    try {
      await api(`/api/events/${action.event.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: action.event.version,
          action: action.kind,
          reason: actionReason,
          ...(action.kind === "cancel" &&
          action.scope === "single" &&
          action.event.recurrence
            ? { occurrenceDate: action.event.recurrenceDate }
            : {}),
        }),
      });
      setAction(null);
      setToast(
        action.kind === "cancel"
          ? "일정을 취소 처리하고 이유를 남겼어요."
          : "휴지통으로 이동했어요. 삭제한 일정은 복구할 수 있어요.",
      );
      try {
        await reload();
      } catch {
        setLoadError(
          "처리는 완료됐지만 최신 조회에 실패했어요. 새로고침해 주세요.",
        );
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "처리하지 못했어요.");
    } finally {
      setActionPending(false);
    }
  };
  const openChanges = async () => {
    setChangesOpen(true);
    setChangesError("");
    try {
      const data = await api<{ changes: ChangeRecord[] }>(
        `/api/changes${publicMode ? "?public=1" : ""}`,
      );
      setChanges(data.changes);
    } catch (e) {
      setChangesError(
        e instanceof Error ? e.message : "변경 기록을 불러오지 못했어요.",
      );
    }
  };
  const openTrash = async () => {
    setTrashOpen(true);
    try {
      const data = await api<{ events: CalendarEvent[] }>("/api/trash");
      setTrash(data.events);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "휴지통을 불러오지 못했어요.");
    }
  };
  const restore = async (event: CalendarEvent) => {
    if (!window.confirm(`‘${event.title}’ 일정을 복구할까요?`)) return;
    try {
      await api(`/api/events/${event.id}`, {
        method: "PATCH",
        body: JSON.stringify({ version: event.version, action: "restore" }),
      });
      setTrash((items) => items.filter((e) => e.id !== event.id));
      setToast("일정을 복구했어요.");
      await reload();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "복구하지 못했어요.");
    }
  };
  const openChangedEvent = async (change: ChangeRecord) => {
    try {
      const data = await api<{ event: CalendarEvent }>(
        `/api/events/${change.eventId}${publicMode ? "?public=1" : ""}`,
      );
      setChangesOpen(false);
      setDetail(
        occurrenceForDate(
          data.event,
          change.occurrenceDate ?? data.event.startDate,
        ),
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : "일정을 열지 못했어요.");
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast("복사했어요.");
    } catch {
      setToast(
        "자동 복사가 지원되지 않아요. 표시된 주소나 문장을 직접 복사해 주세요.",
      );
    }
  };
  const copyWeek = () => {
    const end = addDaysISO(today, 6);
    const events = filterOccurrences(boot?.upcoming ?? [], filter).filter(
      (e) =>
        e.visibility === "public" && e.startDate <= end && e.endDate >= today,
    );
    const text = [
      `예봄교회 이번 주 일정 · ${today} ~ ${end}`,
      ...events.map(
        (e) =>
          `${dateLabel(e.startDate)} ${timeLabel(e)} | ${e.title} | ${organization(e.organizationId).name}${e.location ? ` | ${e.location}` : ""}`,
      ),
      `작성: ${stamp(new Date().toISOString())} · 공개 일정만 포함`,
    ].join("\n");
    void copy(text);
  };
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const params = `org=${selected.join(",")}&all=${includeAll ? "1" : "0"}`;
  const feedURL = `${origin}/api/calendar.ics?${params}`;
  const shareURL = `${origin}/share?${params}&view=${view}&year=${year}&month=${month + 1}`;
  return (
    <div
      className={`app-shell ${large ? "large-type" : ""} ${publicMode ? "public-mode" : ""}`}
    >
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <Link className="brand" href="/">
          <Image src="/logo.svg" alt="" width={42} height={42} unoptimized />
          <span>
            <strong>예봄일정</strong>
            <small>교회 일정, 한눈에 함께</small>
          </span>
        </Link>
        <button
          className="mobile-close icon-button"
          aria-label="부서 메뉴 닫기"
          onClick={() => setSidebarOpen(false)}
        >
          <X size={20} />
        </button>
        <nav className="side-nav">
          <Link className={!publicMode ? "active" : ""} href="/">
            <CalendarDays size={19} />
            우리 교회 일정
          </Link>
          <a className={publicMode ? "active" : ""} href="/share">
            <Monitor size={19} />
            공유 게시판 화면
          </a>
          <button onClick={() => void openChanges()}>
            <History size={19} />
            최근 변경
          </button>
          {mayCreate && (
            <button onClick={() => void openTrash()}>
              <Trash2 size={19} />
              휴지통
            </button>
          )}
        </nav>
        <DepartmentFilter
          selected={selected}
          onChange={setSelected}
          includeAll={includeAll}
          onIncludeAll={setIncludeAll}
        />
        <div className="sidebar-bottom">
          <div className="connect-card">
            <Link2 size={20} />
            <strong>내 휴대폰에서도 함께</strong>
            <p>
              구글·삼성 캘린더에서
              <br />
              교회 일정을 읽어 보세요.
            </p>
            <button className="button" onClick={() => setShareOpen(true)}>
              캘린더 연결 안내 <ArrowRight size={16} />
            </button>
          </div>
          <a
            className="sister-link"
            href="https://finance.yebom.org/"
            target="_blank"
            rel="noreferrer"
          >
            자매 서비스 · 예봄재정 <ArrowRight size={15} />
          </a>
        </div>
      </aside>
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="부서 메뉴 닫기"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <main className="main-content">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="부서 선택 메뉴"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={23} />
          </button>
          <span className="breadcrumb">
            예봄교회 <span>/</span>{" "}
            {publicMode ? "함께 보는 공개 일정" : "함께 쓰는 일정"}
          </span>
          <div className="topbar-actions">
            <button
              className={large ? "text-button active" : "text-button"}
              onClick={() => {
                setLarge(!large);
                if (!large) setView("list");
              }}
            >
              <Type size={18} />
              <span>큰 글씨</span>
            </button>
            {actor?.role === "admin" && (
              <a className="text-button" href="/settings">
                <Settings size={17} />
                <span>설정</span>
              </a>
            )}
            {actor ? (
              <span className="signed-user">
                <i>{actor.name.slice(0, 1)}</i>
                {actor.name}
              </span>
            ) : (
              <button
                className="text-button login-button"
                onClick={() => setAuthOpen(true)}
              >
                <LogIn size={17} />
                로그인
              </button>
            )}
          </div>
        </header>
        <section className="page-heading">
          <div>
            <span className="eyebrow">함께할 시간, 놓치지 않도록</span>
            <h1>{publicMode ? "함께 보는 교회 일정" : "우리 교회 일정"}</h1>
            <p>
              {publicMode
                ? "전체 공개 일정만 표시해요. 로그인 없이 함께 볼 수 있어요."
                : "교회와 부서의 약속을 한곳에서 확인하고 나누세요."}
            </p>
          </div>
          <div className="heading-actions">
            <button className="button" onClick={() => setShareOpen(true)}>
              <Share2 size={18} />
              공유하기
            </button>
            {!publicMode && (
              <button className="button primary" onClick={() => openEditor()}>
                <Plus size={20} />
                일정 등록
              </button>
            )}
          </div>
        </section>
        {!loading && !boot?.auth.configured && !publicMode && (
          <div className="setup-notice">
            <LogIn size={17} />
            <span>
              일정 조회는 사용할 수 있어요. 입력은 기존 교회 로그인 연결과
              담당자 권한 설정 후 사용할 수 있습니다.
            </span>
            <button className="text-button" onClick={() => setAuthOpen(true)}>
              안내
            </button>
          </div>
        )}
        {nextChurch && showChurch && (
          <button className="church-banner" onClick={() => setChurchOpen(true)}>
            <span className="banner-icon">
              <BookOpen size={23} />
            </span>
            <span>
              <small>교회력 참고</small>
              <strong>{nextChurch.name}</strong>
              <span>
                {dateLabel(nextChurch.date)} · 실제 행사와 별도로 표시해요
              </span>
            </span>
            <span className="banner-date">
              {nextChurch.date.slice(5).replace("-", ".")}
              <ArrowRight size={18} />
            </span>
          </button>
        )}
        <section className="calendar-layout">
          <div className="calendar-main">
            <div className="calendar-toolbar">
              <div className="period-nav">
                <h2>
                  {year}년{view !== "year" && ` ${month + 1}월`}
                </h2>
                <button
                  className="icon-button"
                  aria-label={view === "year" ? "이전 연도" : "이전 달"}
                  onClick={() => shift(-1)}
                >
                  <ChevronLeft size={21} />
                </button>
                <button
                  className="icon-button"
                  aria-label={view === "year" ? "다음 연도" : "다음 달"}
                  onClick={() => shift(1)}
                >
                  <ChevronRight size={21} />
                </button>
                <button
                  className="button today-button"
                  onClick={() => {
                    setYear(Number(today.slice(0, 4)));
                    setMonth(Number(today.slice(5, 7)) - 1);
                    setFocusedDate(null);
                  }}
                >
                  오늘
                </button>
              </div>
              <div className="view-tabs" aria-label="일정 보기 방식">
                {(["year", "month", "list"] as const).map((mode) => (
                  <button
                    key={mode}
                    aria-pressed={view === mode}
                    className={view === mode ? "selected" : ""}
                    onClick={() => {
                      setView(mode);
                      setFocusedDate(null);
                    }}
                  >
                    {mode === "year"
                      ? "연간"
                      : mode === "month"
                        ? "월간"
                        : "목록"}
                  </button>
                ))}
              </div>
            </div>
            <div className="calendar-subtoolbar">
              <span>
                {selected.length === ORGANIZATIONS.length
                  ? "전체 부서"
                  : selected.length
                    ? `${selected.length}개 부서`
                    : "선택한 부서 없음"}{" "}
                · {view === "year" ? visible.length : monthEvents.length}개 일정
                {includeAll && " · 전교회 대상 포함"}
              </span>
              <label className="search-field">
                <Search size={17} />
                <input
                  aria-label="일정 이름·장소 검색"
                  placeholder="일정 이름, 장소 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    className="icon-button"
                    aria-label="검색 지우기"
                    onClick={() => setQuery("")}
                  >
                    <X size={16} />
                  </button>
                )}
              </label>
            </div>
            <div className="calendar-options">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={showChurch}
                  onChange={(e) => setShowChurch(e.target.checked)}
                />
                <span>교회력 표시</span>
              </label>
              <button
                className="text-button"
                onClick={() => setChurchOpen(true)}
              >
                절기 안내
              </button>
              <span>참고 교회력은 실제 행사와 구분해요</span>
            </div>
            {loadError && (
              <div className="alert error" role="alert">
                {loadError}
                <button
                  className="button"
                  onClick={() =>
                    void reload().catch((e) => setLoadError(e.message))
                  }
                >
                  <RefreshCw size={16} />
                  다시 불러오기
                </button>
              </div>
            )}
            {loading ? (
              <div className="loading-state">
                <RefreshCw size={25} />
                <p>교회 일정을 불러오고 있어요.</p>
              </div>
            ) : view === "year" ? (
              <YearView
                year={year}
                events={visible}
                days={days}
                today={today}
                onMonth={(m) => {
                  setMonth(m);
                  setView("month");
                  setFocusedDate(null);
                }}
                onDate={onDate}
              />
            ) : view === "month" ? (
              <MonthView
                year={year}
                month={month}
                events={visible}
                days={days}
                today={today}
                onDate={onDate}
                onDetail={setDetail}
              />
            ) : (
              <AgendaView
                events={agendaEvents}
                focusedDate={focusedDate}
                onDetail={setDetail}
                onClear={() => setFocusedDate(null)}
                onCreate={() => openEditor(focusedDate ?? `${monthPrefix}-01`)}
                canEdit={mayCreate}
              />
            )}
            {!loading &&
              !loadError &&
              !boot?.events.length &&
              view !== "list" && (
                <div className="calendar-empty-note">
                  <CalendarDays size={19} />
                  <span>
                    아직 등록된 {publicMode || !actor ? "공개 " : ""}일정이
                    없어요.{" "}
                    {mayCreate
                      ? "날짜를 눌러 첫 일정을 등록해 보세요."
                      : "등록된 일정은 이곳에 표시됩니다."}
                  </span>
                </div>
              )}
            <div className="calendar-footnote">
              <span>
                <i />
                날짜 1개 일정 → 바로 상세 · 여러 일정 → 그날 목록
                {mayCreate ? " · 빈 날짜 → 등록" : ""}
              </span>
              <span>한국 시간 · Asia/Seoul</span>
            </div>
          </div>
          {view !== "year" && (
            <aside className="upcoming">
              <div className="section-title">
                <h3>다가오는 일정</h3>
                <small>{today.slice(5).replace("-", ".")} 기준</small>
              </div>
              {upcoming.length ? (
                upcoming.map((item) => {
                  const org = organization(item.organizationId);
                  return (
                    <button
                      className="upcoming-card"
                      key={item.key}
                      onClick={() => setDetail(item)}
                    >
                      <span className="upcoming-date">
                        <small>{Number(item.startDate.slice(5, 7))}월</small>
                        <strong>{Number(item.startDate.slice(8))}</strong>
                        <small>
                          {
                            ["일", "월", "화", "수", "목", "금", "토"][
                              new Date(
                                `${item.startDate}T12:00:00Z`,
                              ).getUTCDay()
                            ]
                          }
                          요일
                        </small>
                      </span>
                      <span className="upcoming-content">
                        <small style={{ color: org.color }}>
                          <i style={{ background: org.color }} />
                          {org.name}
                        </small>
                        <strong>{item.title}</strong>
                        <span>{timeLabel(item)}</span>
                        {item.location && (
                          <span>
                            <MapPin size={12} />
                            {item.location}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="upcoming-empty">
                  <CalendarDays size={28} />
                  <p>
                    선택한 부서의
                    <br />
                    다가오는 일정이 없어요.
                  </p>
                </div>
              )}
              <div className="print-card">
                <strong>주보·회의에서 함께 보기</strong>
                <p>
                  이번 주 공개 일정만 복사하거나
                  <br />
                  지금 보는 화면을 인쇄하세요.
                </p>
                <button className="button" onClick={copyWeek}>
                  <Copy size={16} />
                  이번 주 안내 복사
                </button>
                <button className="button" onClick={() => window.print()}>
                  <Printer size={17} />
                  화면 인쇄
                </button>
              </div>
              <span className="phase-label">PHASE 1 · 일정에 집중</span>
            </aside>
          )}
        </section>
        <footer className="page-footer">
          <span>기록은 서버에 보관 · 개인정보는 공개 구독에서 제외</span>
          <span>예산 연계 검색은 다음 단계에서</span>
        </footer>
      </main>
      {detail && (
        <EventDetail
          event={detail}
          actor={actor}
          publicMode={publicMode}
          onClose={() => setDetail(null)}
          onEdit={edit}
          onAction={beginAction}
        />
      )}
      {editor && actor && (
        <EventEditor
          key={`${editor.event?.id ?? "new"}:${editor.date}:${editor.scope}`}
          date={editor.date}
          actor={actor}
          event={editor.event}
          scope={editor.scope}
          venues={boot?.venues ?? []}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}
      {emptyDate && (
        <Dialog
          title={`${dateLabel(emptyDate)} 일정`}
          onClose={() => setEmptyDate(null)}
        >
          <div className="dialog-body empty-dialog">
            <CalendarDays size={38} />
            <h3>이 날짜에는 일정이 없어요</h3>
            <p>선택한 부서·검색 범위에서 볼 수 있는 일정이 없습니다.</p>
            {!publicMode && (
              <button
                className="button primary"
                onClick={() => {
                  setEmptyDate(null);
                  setAuthOpen(true);
                }}
              >
                로그인·입력 안내
              </button>
            )}
          </div>
        </Dialog>
      )}
      {authOpen && (
        <Dialog
          title={actor ? "일정 입력 권한 안내" : "교회 계정으로 로그인"}
          onClose={() => setAuthOpen(false)}
        >
          <div className="dialog-body">
            <p>
              재정부와 같은 교회 계정을 사용해요. 입력자와 변경자는 실제 로그인
              사용자로 기록돼요.
            </p>
            <div className="alert">
              {actor
                ? "현재는 조회 권한이에요. 일정 관리자가 담당 부서 권한을 지정하면 일정을 입력할 수 있어요."
                : (boot?.auth.message ??
                  "서버의 로그인 연결 상태를 확인하고 있어요.")}
            </div>
            {boot?.auth.loginUrl && !actor ? (
              <a
                className="button primary"
                href={boot.auth.loginUrl}
                target="_top"
              >
                <LogIn size={18} />
                교회 로그인으로 이동
              </a>
            ) : (
              !actor && (
                <p className="muted">
                  운영 도메인·기존 SSO 검증키·최초 일정 관리자 연결이 필요해요.
                  가상 로그인이나 개발용 관리자 계정을 만들지 않습니다.
                </p>
              )
            )}
            <a className="text-button" href="/settings">
              관리자 설정·연결 안내 <ArrowRight size={16} />
            </a>
          </div>
        </Dialog>
      )}
      {shareOpen && (
        <Dialog
          title="함께 공유하고, 내 캘린더에 담기"
          description="현재 선택한 부서의 전체 공개 일정만 공유해요."
          onClose={() => setShareOpen(false)}
        >
          <div className="dialog-body share-dialog">
            <h3>
              <Monitor size={19} />
              보기 쉬운 공개 게시판
            </h3>
            <p>
              로그인 없이 열어 보는 주소예요. 교인공개·담당자 일정은 표시되지
              않아요.
            </p>
            <div className="copy-field">
              <input readOnly aria-label="공개 일정 주소" value={shareURL} />
              <button className="button" onClick={() => void copy(shareURL)}>
                <Copy size={17} />
                복사
              </button>
            </div>
            <a
              className="text-button"
              href={`/share?${params}&view=${view}&year=${year}&month=${month + 1}`}
              target="_blank"
              rel="noreferrer"
            >
              공개 화면 열기 <ArrowRight size={16} />
            </a>
            <hr />
            <h3>
              <Link2 size={19} />
              구글 캘린더 읽기 전용 구독
            </h3>
            <p>
              PC 구글 캘린더에서 ‘다른 캘린더 + → URL로 추가’에 아래 주소를 붙여
              넣으세요.
            </p>
            <div className="copy-field">
              <input readOnly aria-label="구독 ICS 주소" value={feedURL} />
              <button className="button" onClick={() => void copy(feedURL)}>
                <Copy size={17} />
                복사
              </button>
            </div>
            <ol className="connect-steps">
              <li>처음 구독은 PC 구글 캘린더에서 설정해요.</li>
              <li>
                휴대폰 구글·삼성 캘린더에서 같은 구글 계정의 이 일정표 표시를
                켜세요.
              </li>
              <li>
                업데이트 시각은 구글이 정해요. 급한 변경은 이 서비스에서
                확인하세요.
              </li>
            </ol>
            <p className="alert">
              구독은 운영 서비스 공개 후 고정된 운영 주소로 설정하세요. 개발
              미리보기 주소의 지속적인 외부 구독은 보장하지 않아요.
            </p>
            <a
              className="button"
              href={`/api/calendar.ics?${params}&download=1`}
            >
              일회용 ICS 파일 다운로드
            </a>
            <p className="muted">
              파일 가져오기는 자동 갱신이 아니에요. 공개 피드에는 입력자·변경자
              이름과 내부 메모를 싣지 않아요.
            </p>
          </div>
        </Dialog>
      )}
      {churchOpen && (
        <Dialog
          title={`${year}년 교회력 안내`}
          description="한국 개신교의 서방 그레고리력 기준 참고입니다."
          onClose={() => setChurchOpen(false)}
        >
          <div className="dialog-body">
            <p className="alert">
              교회력은 실제 등록 행사나 휴무가 아니에요. 교단별
              명칭·추수감사주일 등은 교회 설정을 따릅니다.
            </p>
            <div className="church-day-list">
              {churchYear(year, boot?.settings ?? DEFAULT_CHURCH_SETTINGS).map(
                (day, i) => (
                  <div key={`${day.date}-${i}`}>
                    <span>{day.date.slice(5).replace("-", ".")}</span>
                    <strong>{day.name}</strong>
                    <small>{day.note}</small>
                  </div>
                ),
              )}
            </div>
            {actor?.role === "admin" && (
              <a className="button" href="/settings">
                교회력 설정
              </a>
            )}
          </div>
        </Dialog>
      )}
      {changesOpen && (
        <Dialog
          title="최근 변경"
          description="시간·장소 변경과 취소를 놓치지 않도록 모았어요."
          onClose={() => setChangesOpen(false)}
        >
          <div className="dialog-body">
            {changesError && <p className="alert error">{changesError}</p>}
            {!changes.length && !changesError && (
              <p className="muted">볼 수 있는 최근 변경 기록이 없어요.</p>
            )}
            <div className="recent-list">
              {changes.map((change) => (
                <button
                  key={change.id}
                  onClick={() => void openChangedEvent(change)}
                >
                  <span className="change-kind">
                    {kindNames[change.kind] ?? "일정 변경"}
                  </span>
                  <strong>{change.title}</strong>
                  <small>
                    {stamp(change.at)}
                    {change.by && ` · ${change.by.name}`}
                  </small>
                  <span>
                    {change.changedFields
                      .map((f) => fieldNames[f] ?? f)
                      .join(" · ")}
                  </span>
                  {change.reason && <p>{change.reason}</p>}
                </button>
              ))}
            </div>
          </div>
        </Dialog>
      )}
      {trashOpen && (
        <Dialog
          title="일정 휴지통"
          description="담당 권한이 있는 삭제 일정만 표시해요."
          onClose={() => setTrashOpen(false)}
        >
          <div className="dialog-body">
            {!trash.length && <p className="muted">휴지통에 일정이 없어요.</p>}
            {trash.map((event) => (
              <div className="trash-row" key={event.id}>
                <div>
                  <strong>{event.title}</strong>
                  <small>
                    {organization(event.organizationId).name} ·{" "}
                    {event.startDate}
                  </small>
                </div>
                <button className="button" onClick={() => void restore(event)}>
                  복구
                </button>
              </div>
            ))}
          </div>
        </Dialog>
      )}
      {action && (
        <Dialog
          title={
            action.kind === "cancel" ? "일정 취소 처리" : "휴지통으로 이동"
          }
          onClose={() => {
            if (!actionPending) setAction(null);
          }}
        >
          <div className="dialog-body">
            <h3>{action.event.title}</h3>
            {action.event.recurrence && action.kind === "cancel" && (
              <label className="field">
                <span>취소 범위</span>
                <select
                  value={action.scope}
                  disabled={actionPending}
                  onChange={(e) =>
                    setAction({ ...action, scope: e.target.value as EditScope })
                  }
                >
                  <option value="single">이번 회차만</option>
                  <option value="series">반복 전체</option>
                </select>
              </label>
            )}
            {action.kind === "delete" && (
              <p className="alert">
                반복 일정은 시리즈 전체를 휴지통에 보관해요. 한 회차만 없애려면
                ‘취소 처리’를 사용하세요.
              </p>
            )}
            <label className="field">
              <span>
                {action.kind === "cancel"
                  ? "취소 이유 · 필수"
                  : "삭제 이유 · 선택"}
              </span>
              <textarea
                maxLength={500}
                rows={3}
                value={actionReason}
                disabled={actionPending}
                onChange={(e) => setActionReason(e.target.value)}
              />
            </label>
            {actionError && (
              <p className="alert error" role="alert">
                {actionError}
              </p>
            )}
          </div>
          <footer className="dialog-actions">
            <button
              className="button"
              disabled={actionPending}
              onClick={() => setAction(null)}
            >
              돌아가기
            </button>
            <button
              className="button danger"
              disabled={
                actionPending ||
                (action.kind === "cancel" && !actionReason.trim())
              }
              onClick={() => void submitAction()}
            >
              <Ban size={17} />
              {actionPending
                ? "처리 중…"
                : action.kind === "cancel"
                  ? "취소 기록 남기기"
                  : "휴지통으로 이동"}
            </button>
          </footer>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="알림 닫기"
            onClick={() => setToast("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
