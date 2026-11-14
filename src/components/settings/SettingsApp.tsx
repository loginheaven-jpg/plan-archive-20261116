"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Church,
  Info,
  LoaderCircle,
  LogIn,
  MapPin,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { ORGANIZATIONS } from "@/domain/organizations";
import type {
  Actor,
  AuthStatus,
  Bootstrap,
  ChurchSettings,
  OrganizationId,
  Venue,
} from "@/domain/types";

type Role = Actor["role"];

interface SettingsResponse {
  settings: ChurchSettings;
  venues: Venue[];
}

interface ManagedUser extends Actor {
  lastSeenAt: string | null;
}

interface UsersResponse {
  users: ManagedUser[];
}

const ROLE_LABELS: Record<Role, string> = {
  viewer: "조회",
  editor: "부서담당",
  admin: "일정관리",
};

// Unconfirmed church customs are never enabled as if they were actual events.
const DEFAULT_SETTINGS: ChurchSettings = {
  denomination: "",
  ashWednesday: false,
  ascension: false,
  thanksgiving: {
    enabled: false,
    rule: "nthSunday",
    month: 11,
    nth: 3,
    day: 1,
  },
  reformationSunday: false,
  newYear: false,
  yearEnd: false,
};

const ROW_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  flexWrap: "wrap" as const,
};

const STACK_STYLE = { display: "grid", gap: "1rem" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChurchSettings(value: unknown): value is ChurchSettings {
  if (!isRecord(value) || !isRecord(value.thanksgiving)) return false;
  const thanksgiving = value.thanksgiving;
  return (
    typeof value.denomination === "string" &&
    typeof value.ashWednesday === "boolean" &&
    typeof value.ascension === "boolean" &&
    typeof value.reformationSunday === "boolean" &&
    typeof value.newYear === "boolean" &&
    typeof value.yearEnd === "boolean" &&
    typeof thanksgiving.enabled === "boolean" &&
    (thanksgiving.rule === "nthSunday" || thanksgiving.rule === "fixedDate") &&
    typeof thanksgiving.month === "number" &&
    typeof thanksgiving.nth === "number" &&
    typeof thanksgiving.day === "number"
  );
}

function isVenueList(value: unknown): value is Venue[] {
  return (
    Array.isArray(value) &&
    value.every(
      (venue: unknown) =>
        isRecord(venue) &&
        typeof venue.id === "string" &&
        typeof venue.name === "string",
    )
  );
}

function isManagedUser(value: unknown): value is ManagedUser {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.role === "viewer" || value.role === "editor" || value.role === "admin") &&
    Array.isArray(value.departmentIds) &&
    value.departmentIds.every((id: unknown) =>
      ORGANIZATIONS.some((department) => department.id === id),
    ) &&
    (value.lastSeenAt === null || typeof value.lastSeenAt === "string")
  );
}

async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
  requireStatus200 = false,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("서버에 연결하지 못했어요. 입력을 유지한 채 다시 시도해 주세요.");
  }

  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || (requireStatus200 && response.status !== 200)) {
    const message = isRecord(result)
      ? typeof result.error === "string"
        ? result.error
        : typeof result.message === "string"
          ? result.message
          : null
      : null;
    throw new Error(message ?? "요청을 처리하지 못했어요. 입력을 유지한 채 다시 시도해 주세요.");
  }
  if (result === null) {
    throw new Error("서버 응답 형식을 확인하지 못했어요. 저장 여부를 확인한 뒤 다시 시도해 주세요.");
  }
  return result as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "처리 중 문제가 생겼어요. 다시 시도해 주세요.";
}

function koreaYear(): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    timeZone: "Asia/Seoul",
  }).format(new Date());
}

function lastSeenLabel(value: string | null): string {
  if (!value) return "아직 확인되지 않음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인할 수 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function userPermissionKey(user: ManagedUser): string {
  return JSON.stringify({ role: user.role, departmentIds: [...user.departmentIds].sort() });
}

function settingsKey(settings: ChurchSettings, venues: Venue[]): string {
  return JSON.stringify({ settings, venues });
}

export default function SettingsApp() {
  const [actor, setActor] = useState<Actor | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [settings, setSettings] = useState<ChurchSettings>(DEFAULT_SETTINGS);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [savedSettingsKey, setSavedSettingsKey] = useState<string | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [savedUsers, setSavedUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersLoadError, setUsersLoadError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [userErrors, setUserErrors] = useState<Record<string, string>>({});
  const [userSuccesses, setUserSuccesses] = useState<Record<string, string>>({});

  const isAdmin = actor?.role === "admin";
  const settingsDirty =
    savedSettingsKey !== null && settingsKey(settings, venues) !== savedSettingsKey;
  const userIsDirty = (user: ManagedUser) => {
    const saved = savedUsers.find((candidate) => candidate.id === user.id);
    return !!saved && userPermissionKey(user) !== userPermissionKey(saved);
  };
  const usersDirty = users.some(userIsDirty);
  const saving = savingSettings || savingUserId !== null;
  const dirty = settingsDirty || usersDirty;
  const settingsDisabled = !isAdmin || !settingsReady || saving;

  useEffect(() => {
    const controller = new AbortController();
    const options: RequestInit = { signal: controller.signal };

    async function load() {
      setLoading(true);
      setLoadError(null);
      setSettingsLoadError(null);
      setSettingsReady(false);
      setUsersLoadError(null);
      try {
        const bootstrap = await fetchJson<Bootstrap>(
          `/api/bootstrap?year=${koreaYear()}`,
          options,
        );
        if (controller.signal.aborted) return;
        if (!isChurchSettings(bootstrap.settings) || !isVenueList(bootstrap.venues)) {
          throw new Error("교회 설정 응답을 확인하지 못했어요. 다시 불러와 주세요.");
        }
        setActor(bootstrap.actor);
        setAuth(bootstrap.auth);
        setSettings(bootstrap.settings);
        setVenues(bootstrap.venues);
        setSavedSettingsKey(settingsKey(bootstrap.settings, bootstrap.venues));
        setUsers([]);
        setSavedUsers([]);

        const loadSettings = async () => {
          try {
            const response = await fetchJson<SettingsResponse>("/api/settings", options);
            if (controller.signal.aborted) return;
            if (!isChurchSettings(response.settings) || !isVenueList(response.venues)) {
              throw new Error("교회 설정 응답을 확인하지 못했어요. 다시 불러와 주세요.");
            }
            setSettings(response.settings);
            setVenues(response.venues);
            setSavedSettingsKey(settingsKey(response.settings, response.venues));
            setSettingsReady(true);
          } catch (error: unknown) {
            if (!controller.signal.aborted) setSettingsLoadError(errorMessage(error));
          }
        };

        const loadUsers = async () => {
          if (bootstrap.actor?.role !== "admin") return;
          setUsersLoading(true);
          try {
            const response = await fetchJson<UsersResponse>("/api/admin/users", options);
            if (controller.signal.aborted) return;
            if (!Array.isArray(response.users) || !response.users.every(isManagedUser)) {
              throw new Error("검증된 사용자 목록 응답을 확인하지 못했어요.");
            }
            setUsers(response.users);
            setSavedUsers(response.users);
          } catch (error: unknown) {
            if (!controller.signal.aborted) setUsersLoadError(errorMessage(error));
          } finally {
            if (!controller.signal.aborted) setUsersLoading(false);
          }
        };

        await Promise.all([loadSettings(), loadUsers()]);
      } catch (error: unknown) {
        if (!controller.signal.aborted) setLoadError(errorMessage(error));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [loadRevision]);

  useEffect(() => {
    if (!dirty && !saving) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, saving]);

  function confirmNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (saving) {
      event.preventDefault();
      window.alert("저장 중이에요. 저장 결과를 확인한 뒤 이동해 주세요.");
    } else if (dirty && !window.confirm("저장하지 않은 변경이 있어요. 저장하지 않고 이동할까요?")) {
      event.preventDefault();
    }
  }

  function reload() {
    if (saving) return;
    if (dirty && !window.confirm("저장하지 않은 변경이 있어요. 변경을 버리고 다시 불러올까요?")) {
      return;
    }
    setSettingsError(null);
    setSettingsSuccess(null);
    setUserErrors({});
    setUserSuccesses({});
    setLoadRevision((revision) => revision + 1);
  }

  function updateSettings(patch: Partial<ChurchSettings>) {
    if (settingsDisabled) return;
    setSettings((current) => ({ ...current, ...patch }));
    setSettingsError(null);
    setSettingsSuccess(null);
  }

  function updateThanksgiving(patch: Partial<ChurchSettings["thanksgiving"]>) {
    if (settingsDisabled) return;
    setSettings((current) => ({
      ...current,
      thanksgiving: { ...current.thanksgiving, ...patch },
    }));
    setSettingsError(null);
    setSettingsSuccess(null);
  }

  function updateVenue(id: string, name: string) {
    if (settingsDisabled) return;
    setVenues((current) => current.map((venue) => (venue.id === id ? { ...venue, name } : venue)));
    setSettingsError(null);
    setSettingsSuccess(null);
  }

  function addVenue() {
    if (settingsDisabled) return;
    try {
      const id = crypto.randomUUID();
      setVenues((current) => [...current, { id, name: "" }]);
      setSettingsError(null);
      setSettingsSuccess(null);
    } catch {
      setSettingsError("장소 식별자를 만들지 못했어요. 보안 연결 상태를 확인하고 다시 시도해 주세요.");
    }
  }

  function removeVenue(venue: Venue) {
    if (settingsDisabled) return;
    const label = venue.name.trim() || "이 장소";
    if (!window.confirm(`‘${label}’를 장소 목록에서 삭제할까요? 설정 저장 후 반영되며, 일정에서 사용 중인 장소는 삭제할 수 없어요.`)) {
      return;
    }
    setVenues((current) => current.filter((candidate) => candidate.id !== venue.id));
    setSettingsError(null);
    setSettingsSuccess(null);
  }

  async function saveSettings() {
    if (!isAdmin || !settingsReady || saving || !settingsDirty) return;
    setSettingsError(null);
    setSettingsSuccess(null);
    const normalizedVenues = venues.map((venue) => ({ id: venue.id, name: venue.name.trim() }));
    if (normalizedVenues.some((venue) => !venue.name)) {
      setSettingsError("장소 이름을 모두 입력해 주세요. 사용하지 않을 새 장소는 삭제할 수 있어요.");
      return;
    }
    const submittedSettings: ChurchSettings = {
      ...settings,
      thanksgiving: { ...settings.thanksgiving },
    };
    setSavingSettings(true);
    try {
      const response = await fetchJson<unknown>(
        "/api/settings",
        {
          method: "PUT",
          body: JSON.stringify({ settings: submittedSettings, venues: normalizedVenues }),
        },
        true,
      );
      const savedSettings =
        isRecord(response) && isChurchSettings(response.settings)
          ? response.settings
          : submittedSettings;
      const savedVenues =
        isRecord(response) && isVenueList(response.venues)
          ? response.venues
          : normalizedVenues;
      setSettings(savedSettings);
      setVenues(savedVenues);
      setSavedSettingsKey(settingsKey(savedSettings, savedVenues));
      setSettingsSuccess("교회력과 장소 설정을 저장했어요.");
    } catch (error: unknown) {
      setSettingsError(errorMessage(error));
    } finally {
      setSavingSettings(false);
    }
  }

  function updateUser(id: string, patch: Partial<Pick<ManagedUser, "role" | "departmentIds">>) {
    if (!isAdmin || saving) return;
    setUsers((current) => current.map((user) => (user.id === id ? { ...user, ...patch } : user)));
    setUserErrors((current) => ({ ...current, [id]: "" }));
    setUserSuccesses((current) => ({ ...current, [id]: "" }));
  }

  function toggleDepartment(user: ManagedUser, id: OrganizationId, checked: boolean) {
    const departmentIds = checked
      ? [...user.departmentIds.filter((departmentId) => departmentId !== id), id]
      : user.departmentIds.filter((departmentId) => departmentId !== id);
    updateUser(user.id, { departmentIds });
  }

  async function saveUser(user: ManagedUser) {
    if (!isAdmin || saving || !userIsDirty(user)) return;
    if (
      user.id === actor?.id &&
      user.role !== actor.role &&
      !window.confirm("본인의 권한을 변경하면 설정 편집 권한을 잃을 수 있어요. 본인 권한을 저장할까요?")
    ) {
      return;
    }
    setUserErrors((current) => ({ ...current, [user.id]: "" }));
    setUserSuccesses((current) => ({ ...current, [user.id]: "" }));
    setSavingUserId(user.id);
    try {
      const response = await fetchJson<unknown>(
        "/api/admin/users",
        {
          method: "PATCH",
          body: JSON.stringify({ id: user.id, role: user.role, departmentIds: user.departmentIds }),
        },
        true,
      );
      const savedUser =
        isRecord(response) && isManagedUser(response.user) && response.user.id === user.id
          ? response.user
          : { ...user, departmentIds: [...user.departmentIds] };
      setUsers((current) => current.map((candidate) => (candidate.id === user.id ? savedUser : candidate)));
      setSavedUsers((current) => current.map((candidate) => (candidate.id === user.id ? savedUser : candidate)));
      setUserSuccesses((current) => ({ ...current, [user.id]: "권한을 저장했어요." }));
      if (user.id === actor?.id) {
        setActor({
          id: savedUser.id,
          name: savedUser.name,
          role: savedUser.role,
          departmentIds: [...savedUser.departmentIds],
        });
      }
    } catch (error: unknown) {
      setUserErrors((current) => ({ ...current, [user.id]: errorMessage(error) }));
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <main className="shell settings-page">
      <header style={{ ...ROW_STYLE, justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <p className="muted">예봄일정</p>
          <h1 style={{ ...ROW_STYLE, margin: "0.25rem 0" }}>
            <Church size={26} aria-hidden="true" /> 교회 설정
          </h1>
          <p className="muted">교회력 참고 표시, 장소와 일정 담당 권한을 관리해요.</p>
        </div>
        <Link href="/" className="button" onClick={confirmNavigation} prefetch={false}>
          <ArrowLeft size={18} aria-hidden="true" /> 일정으로 돌아가기
        </Link>
      </header>

      {loading ? (
        <section className="settings-card" role="status" aria-live="polite">
          <p style={ROW_STYLE}><LoaderCircle size={20} aria-hidden="true" /> 실제 로그인 상태와 설정을 불러오고 있어요.</p>
        </section>
      ) : loadError ? (
        <section className="settings-card">
          <p className="alert" role="alert">{loadError}</p>
          <button type="button" className="button" onClick={reload}>다시 불러오기</button>
          <p className="muted">로그인 상태를 확인하기 전에는 설정을 편집할 수 없어요.</p>
        </section>
      ) : (
        <div style={STACK_STYLE}>
          <section className="settings-card" aria-labelledby="settings-auth-title">
            <h2 id="settings-auth-title" className="section-title" style={ROW_STYLE}>
              <ShieldCheck size={21} aria-hidden="true" /> 로그인과 편집 권한
            </h2>
            {actor ? (
              <p><strong>{actor.name}</strong> 님 · {ROLE_LABELS[actor.role]}</p>
            ) : (
              <p>로그인된 사용자가 없어요. 가상 계정이나 임시 관리자 권한은 제공하지 않아요.</p>
            )}
            {!isAdmin && <p className="muted">설정 변경과 담당 권한 부여는 일정관리 권한이 있는 사용자만 할 수 있어요.</p>}
            {auth?.message && <p className="muted">{auth.message}</p>}
            {auth && (!auth.configured || !auth.onSharedDomain) && (
              <div className="alert" role="note">
                <p>실제 교적부 로그인을 사용하려면 서버의 세션 검증키, 교적부의 허용 복귀 주소와 운영 도메인을 연결해야 해요.</p>
                <p>교적부의 공유 쿠키가 전달되는 도메인에서 확인해야 하며, 다른 도메인의 미리보기만으로 로그인 연결이 완료되지는 않아요.</p>
              </div>
            )}
            {!isAdmin && (
              <p className="muted">최초 일정관리자는 운영자가 검증된 교적부 사용자 식별자로 서버에 지정해야 해요. 이름을 임의로 입력해 사용자를 만들거나 재정 권한으로 자동 승인하지 않아요.</p>
            )}
            {auth?.loginUrl && (
              <a className="button" href={auth.loginUrl} onClick={confirmNavigation}>
                <LogIn size={18} aria-hidden="true" /> 교적부 로그인으로 이동
              </a>
            )}
          </section>

          {settingsLoadError && (
            <section className="settings-card">
              <p className="alert" role="alert">{settingsLoadError}</p>
              <p className="muted">처음 불러온 참고 설정을 표시하고 있어요. 최신 설정을 확인하기 전에는 변경을 저장할 수 없어요.</p>
              <button type="button" className="button" disabled={saving} onClick={reload}>설정 다시 불러오기</button>
            </section>
          )}

          <section className="settings-card" aria-labelledby="church-calendar-title">
            <h2 id="church-calendar-title" className="section-title" style={ROW_STYLE}>
              <Church size={21} aria-hidden="true" /> 교회력 참고 표시
            </h2>
            <div className="alert" role="note" style={{ marginBottom: "1rem" }}>
              <p style={ROW_STYLE}><Info size={18} aria-hidden="true" /> 교회력 표시는 참고 정보이며 실제 등록 행사나 휴무가 아니에요.</p>
              <p>서방 그레고리력 기준으로 계산하며, 절기의 명칭과 준수 방식은 교단과 교회 관행에 따라 달라요. 실제 예배나 행사는 일정에서 별도로 등록해 주세요.</p>
            </div>
            <fieldset disabled={settingsDisabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend className="muted" style={{ marginBottom: "1rem" }}>교회에서 확인한 관행에 맞게 선택해 주세요.</legend>
              <div className="form-grid">
                <label className="field">
                  <span>소속 교단 또는 교회력 기준</span>
                  <input
                    type="text"
                    value={settings.denomination}
                    onChange={(event) => updateSettings({ denomination: event.target.value })}
                    placeholder="확인한 교단이나 기준을 입력해 주세요"
                  />
                </label>
              </div>
              <div style={{ ...STACK_STYLE, marginTop: "1rem" }}>
                <label className="checkbox-row">
                  <input type="checkbox" checked={settings.ashWednesday} onChange={(event) => updateSettings({ ashWednesday: event.target.checked })} />
                  재의 수요일 참고 표시
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={settings.ascension} onChange={(event) => updateSettings({ ascension: event.target.checked })} />
                  승천일 참고 표시
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={settings.reformationSunday} onChange={(event) => updateSettings({ reformationSunday: event.target.checked })} />
                  종교개혁주일 참고 표시
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={settings.newYear} onChange={(event) => updateSettings({ newYear: event.target.checked })} />
                  신년 참고 표시
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={settings.yearEnd} onChange={(event) => updateSettings({ yearEnd: event.target.checked })} />
                  송구영신 참고 표시
                </label>
              </div>

              <h3 style={{ marginTop: "1.5rem" }}>추수감사 참고 표시</h3>
              <p className="muted">교회의 실제 관행이 아직 확인되지 않은 경우 기본값은 표시하지 않음이에요. 이미 저장된 선택과 날짜는 그대로 유지해요.</p>
              <label className="checkbox-row">
                <input type="checkbox" checked={settings.thanksgiving.enabled} onChange={(event) => updateThanksgiving({ enabled: event.target.checked })} />
                추수감사 참고 표시 사용
              </label>
              <fieldset disabled={!settings.thanksgiving.enabled} style={{ border: 0, padding: 0, margin: "1rem 0 0", minWidth: 0 }}>
                <legend className="muted" style={{ marginBottom: "0.75rem" }}>교회에서 확인한 날짜 규칙</legend>
                <div className="form-grid">
                  <label className="field">
                    <span>날짜 규칙</span>
                    <select value={settings.thanksgiving.rule} onChange={(event) => updateThanksgiving({ rule: event.target.value === "fixedDate" ? "fixedDate" : "nthSunday" })}>
                      <option value="nthSunday">해당 월의 주일</option>
                      <option value="fixedDate">고정 날짜</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>월</span>
                    <select value={settings.thanksgiving.month} onChange={(event) => updateThanksgiving({ month: Number(event.target.value) })}>
                      {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month}월</option>)}
                    </select>
                  </label>
                  {settings.thanksgiving.rule === "nthSunday" ? (
                    <label className="field">
                      <span>몇 번째 주일</span>
                      <select value={settings.thanksgiving.nth} onChange={(event) => updateThanksgiving({ nth: Number(event.target.value) })}>
                        {["첫째", "둘째", "셋째", "넷째", "다섯째"].map((label, index) => <option key={label} value={index + 1}>{label} 주일</option>)}
                      </select>
                    </label>
                  ) : (
                    <label className="field">
                      <span>일</span>
                      <select value={settings.thanksgiving.day} onChange={(event) => updateThanksgiving({ day: Number(event.target.value) })}>
                        {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}일</option>)}
                      </select>
                    </label>
                  )}
                </div>
              </fieldset>
              <p className="muted">고정 기념일과 실제 주일 예배 날짜는 다를 수 있어요. 다섯째 주일은 해당 월에 없을 수 있어요.</p>
            </fieldset>
          </section>

          <section className="settings-card" aria-labelledby="venues-title">
            <div style={{ ...ROW_STYLE, justifyContent: "space-between" }}>
              <h2 id="venues-title" className="section-title" style={ROW_STYLE}><MapPin size={21} aria-hidden="true" /> 자주 쓰는 장소</h2>
              <button type="button" className="button" disabled={settingsDisabled} onClick={addVenue}><Plus size={18} aria-hidden="true" /> 장소 추가</button>
            </div>
            <p className="muted">확인한 실제 장소만 등록해 주세요. 이름을 바꿔도 장소 식별자는 유지하며, 일정에서 사용 중인 장소의 삭제는 서버가 차단해요. 정식 예약 승인을 의미하지 않아요.</p>
            {venues.length === 0 ? (
              <p className="muted">등록된 장소가 없어요. 실제 장소를 확인한 일정관리자가 추가할 수 있어요.</p>
            ) : (
              <div style={STACK_STYLE}>
                {venues.map((venue, index) => (
                  <div key={venue.id} style={{ ...ROW_STYLE, alignItems: "flex-end" }}>
                    <label className="field" style={{ flex: "1 1 15rem" }}>
                      <span>장소 {index + 1}</span>
                      <input type="text" value={venue.name} disabled={settingsDisabled} onChange={(event) => updateVenue(venue.id, event.target.value)} placeholder="확인한 장소 이름" />
                    </label>
                    <button type="button" className="button" disabled={settingsDisabled} onClick={() => removeVenue(venue)} aria-label={`${venue.name.trim() || `장소 ${index + 1}`} 삭제`}><Trash2 size={18} aria-hidden="true" /> 삭제</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="settings-card" aria-label="교회력과 장소 설정 저장">
            {settingsError && <p className="alert" role="alert">{settingsError}</p>}
            {settingsSuccess && <p role="status" style={ROW_STYLE}><CheckCircle2 size={18} aria-hidden="true" /> {settingsSuccess}</p>}
            <div style={{ ...ROW_STYLE, justifyContent: "space-between" }}>
              <p className="muted">{settingsDirty ? "교회력 또는 장소에 저장하지 않은 변경이 있어요." : "교회력과 장소는 아래 저장 버튼을 눌러야 변경돼요."}</p>
              <button type="button" className="button primary" disabled={settingsDisabled || !settingsDirty} onClick={() => void saveSettings()}>
                {savingSettings ? <LoaderCircle size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
                {savingSettings ? "설정 저장 중" : "교회력·장소 저장"}
              </button>
            </div>
          </section>

          <section className="settings-card" aria-labelledby="users-title">
            <h2 id="users-title" className="section-title" style={ROW_STYLE}><Users size={21} aria-hidden="true" /> 검증된 사용자와 담당 권한</h2>
            <p className="muted">교적부에서 실제 인증이 확인된 사용자만 표시해요. 사용자 이름을 입력해서 새 계정을 만들 수 없으며, 재정 서비스의 역할로 일정 권한을 자동 부여하지 않아요.</p>
            <dl className="form-grid">
              <div><dt><strong>조회</strong></dt><dd style={{ margin: "0.5rem 0" }}>허용된 공개 범위의 일정을 볼 수 있어요.</dd></div>
              <div><dt><strong>부서담당</strong></dt><dd style={{ margin: "0.5rem 0" }}>아래에서 허용한 부서의 일정을 편집해요.</dd></div>
              <div><dt><strong>일정관리</strong></dt><dd style={{ margin: "0.5rem 0" }}>모든 부서의 일정과 설정·담당 권한을 관리해요.</dd></div>
            </dl>
            <p className="muted">전교회의 원본 책임 조직은 당회예요. 부서 선택은 부서담당의 편집 범위이며, 조회 권한에는 편집 권한이 생기지 않고 일정관리는 전체 관리 권한을 가져요.</p>
            <p className="muted">권한 변경은 사용자별 ‘권한 저장’을 눌러야 반영돼요. 마지막 일정관리자의 권한 해제는 서버에서 차단해요.</p>
            {!isAdmin && <div className="alert" role="note">일정관리 권한을 확인한 뒤 실제 사용자 목록과 권한 변경 기능을 이용할 수 있어요. 최초 관리자 연결은 운영자의 실제 설정이 필요해요.</div>}
            {usersLoading && <p role="status" style={ROW_STYLE}><LoaderCircle size={18} aria-hidden="true" /> 검증된 사용자 목록을 불러오고 있어요.</p>}
            {usersLoadError && (
              <div>
                <p className="alert" role="alert">{usersLoadError}</p>
                <button type="button" className="button" disabled={saving} onClick={reload}>사용자 목록 다시 불러오기</button>
              </div>
            )}
            {isAdmin && !usersLoading && !usersLoadError && users.length === 0 && <p className="muted">서버에 기록된 검증된 사용자가 아직 없어요. 실제 교적부 로그인과 사용자 등록 상태를 운영자가 확인해 주세요.</p>}
            <div style={STACK_STYLE}>
              {users.map((user, index) => {
                const changed = userIsDirty(user);
                const ownRoleChanged = user.id === actor?.id && user.role !== actor.role;
                const userDisabled = !isAdmin || saving;
                return (
                  <article key={user.id} style={{ borderTop: "1px solid #e3e7e3", paddingTop: "1rem" }} aria-labelledby={`settings-user-${index}`}>
                    <div style={{ ...ROW_STYLE, justifyContent: "space-between" }}>
                      <h3 id={`settings-user-${index}`} style={{ margin: 0 }}>{user.name}{user.id === actor?.id ? " · 본인" : ""}</h3>
                      <p className="muted">최근 인증 확인: {lastSeenLabel(user.lastSeenAt)} · 한국시간</p>
                    </div>
                    <p className="muted">검증된 사용자 식별자: {user.id}</p>
                    <label className="field" style={{ maxWidth: "20rem" }}>
                      <span>일정 권한</span>
                      <select value={user.role} disabled={userDisabled} onChange={(event) => {
                        const role = event.target.value;
                        if (role === "viewer" || role === "editor" || role === "admin") updateUser(user.id, { role });
                      }}>
                        <option value="viewer">조회</option>
                        <option value="editor">부서담당</option>
                        <option value="admin">일정관리</option>
                      </select>
                    </label>
                    <fieldset disabled={userDisabled} style={{ border: 0, margin: "1rem 0", padding: 0, minWidth: 0 }}>
                      <legend style={{ marginBottom: "0.75rem" }}>허용 부서 · 부서담당의 일정 편집 범위</legend>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "0.75rem" }}>
                        {ORGANIZATIONS.map((department) => (
                          <label key={department.id} className="checkbox-row">
                            <input type="checkbox" checked={user.departmentIds.includes(department.id)} onChange={(event) => toggleDepartment(user, department.id, event.target.checked)} />
                            {department.id === "admin" ? "전교회(당회)" : department.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    {ownRoleChanged && <p className="alert" role="note">본인의 권한을 변경하고 있어요. 일정관리 권한을 해제하면 이 화면에서 설정을 편집할 수 없게 돼요.</p>}
                    {userErrors[user.id] && <p className="alert" role="alert">{userErrors[user.id]}</p>}
                    {userSuccesses[user.id] && <p role="status" style={ROW_STYLE}><CheckCircle2 size={18} aria-hidden="true" /> {userSuccesses[user.id]}</p>}
                    <div style={ROW_STYLE}>
                      <button type="button" className="button primary" disabled={userDisabled || !changed} onClick={() => void saveUser(user)}>
                        {savingUserId === user.id ? <LoaderCircle size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
                        {savingUserId === user.id ? "권한 저장 중" : "권한 저장"}
                      </button>
                      {changed && <span className="muted">이 사용자의 권한 변경을 아직 저장하지 않았어요.</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {dirty && <p className="alert" role="status">저장하지 않은 변경이 있어요. 교회력·장소와 사용자별 권한은 각각 저장해 주세요.</p>}
        </div>
      )}
    </main>
  );
}
