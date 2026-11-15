import { useEffect, useRef, useState } from "react";
import type {
  Actor,
  CalendarEvent,
  EventInput,
  Occurrence,
  Venue,
  OrganizationId,
} from "@/domain/types";
import { ORGANIZATIONS, organization } from "@/domain/organizations";
import { canCreate, canEditEvent } from "@/domain/permissions";
import Dialog from "./Dialog";
import RecurrenceFields from "./RecurrenceFields";
import DateExpressionField from "./DateExpressionField";
import { Save, UserRound, ChevronDown } from "lucide-react";
import LoginLink from "@/components/auth/LoginLink";

export type EditScope = "single" | "series";
function initialInput(
  date: string,
  actor: Actor | null,
  event?: CalendarEvent | Occurrence,
  defaultOrganizationId?: OrganizationId,
): EventInput {
  if (event)
    return {
      title: event.title,
      organizationId: event.organizationId,
      startDate: event.startDate,
      endDate: event.endDate,
      allDay: event.allDay,
      startTime: event.startTime,
      endTime: event.endTime,
      audience: event.audience,
      audienceIds: event.audienceIds,
      visibility: event.visibility,
      locationId: event.locationId,
      location: event.location,
      description: event.description,
      internalNote: event.internalNote,
      recurrence: event.recurrence,
      status: event.status === "tentative" ? "tentative" : "confirmed",
    };
  const department =
    defaultOrganizationId &&
    (actor?.role === "admin" ||
      actor?.departmentIds.includes(defaultOrganizationId))
      ? defaultOrganizationId
      : (actor?.departmentIds[0] ?? "worship");
  return {
    title: "",
    organizationId: department,
    startDate: date,
    endDate: date,
    allDay: true,
    startTime: "09:00",
    endTime: "10:00",
    audience: "all",
    audienceIds: [],
    visibility: "public",
    locationId: null,
    location: "",
    description: "",
    internalNote: "",
    recurrence: null,
    status: "confirmed",
  };
}
export default function EventEditor({
  date,
  actor,
  event,
  scope,
  venues,
  defaultOrganizationId,
  onClose,
  onSave,
}: {
  date: string;
  actor: Actor | null;
  event?: CalendarEvent | Occurrence;
  scope: EditScope;
  venues: Venue[];
  defaultOrganizationId?: OrganizationId;
  onClose: () => void;
  onSave: (
    input: EventInput,
    operationId: string,
    reason: string,
  ) => Promise<void>;
}) {
  const [form, setForm] = useState(() =>
    initialInput(date, actor, event, defaultOrganizationId),
  );
  // This snapshot identifies the owner of the in-memory form; it never grants
  // write authority. Save permissions always use the current actor below.
  const [draftAuthorId] = useState(actor?.id ?? null);
  const authorized =
    !!actor &&
    actor.id === draftAuthorId &&
    (event ? canEditEvent(event, actor) : canCreate(actor)) &&
    canEditEvent(form, actor);
  const [original, setOriginal] = useState(JSON.stringify(form));
  const operationId = useRef(crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [resumeConfirmed, setResumeConfirmed] = useState(false);
  const [dateExpressionDirty, setDateExpressionDirty] = useState(false);
  const resuming = event?.status === "cancelled";
  const isSingle = !!event?.recurrence && scope === "single";
  const dirty =
    JSON.stringify(form) !== original ||
    reason !== "" ||
    resumeConfirmed ||
    dateExpressionDirty;
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const close = () => {
    if (
      !pending &&
      (!dirty || window.confirm("입력한 내용을 저장하지 않고 닫을까요?"))
    )
      onClose();
  };
  const update = <K extends keyof EventInput>(key: K, value: EventInput[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const allowed =
    actor?.role === "admin"
      ? ORGANIZATIONS
      : ORGANIZATIONS.filter((o) => actor?.departmentIds.includes(o.id));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!authorized) {
      setError(
        "같은 계정의 현재 편집 권한을 확인해야 저장할 수 있어요. 입력은 보관되어 있어요.",
      );
      return;
    }
    if (dateExpressionDirty) {
      setError("날짜 표현을 먼저 적용하거나 지운 뒤 등록해 주세요.");
      return;
    }
    if (resuming && (!resumeConfirmed || !reason.trim())) {
      setError(
        "취소 해제를 명시적으로 확인하고 다시 진행하는 이유를 입력해 주세요.",
      );
      return;
    }
    setPending(true);
    try {
      await onSave(
        {
          ...form,
          startTime: form.allDay ? null : form.startTime,
          endTime: form.allDay ? null : form.endTime,
        },
        operationId.current,
        reason,
      );
      setOriginal(JSON.stringify(form));
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "저장하지 못했어요. 입력 내용은 그대로 남아 있어요.",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      wide
      title={
        resuming
          ? "취소한 일정 다시 시작"
          : event
            ? isSingle
              ? "이번 일정만 수정"
              : "일정 수정"
            : "새 일정 등록"
      }
      description={
        resuming
          ? "취소를 해제하려는 경우에만 확인하세요. 이유와 변경 기록을 함께 남겨요."
          : isSingle
            ? "다른 회차는 그대로 유지해요. 주관부서·공개 범위는 반복 전체에서 바꿀 수 있어요."
            : "이름과 날짜를 적고, 주관부서를 선택하세요."
      }
      onClose={close}
    >
      <form onSubmit={submit} className="event-form">
        {!authorized && (
          <div className="alert" role="status">
            <p>
              로그인 또는 편집 권한을 다시 확인해 주세요. 작성 중인 입력은
              보관되어 있으며 같은 계정으로 돌아오면 이어 쓸 수 있어요.
            </p>
            <LoginLink
              className="button"
              target="_blank"
              rel="noopener noreferrer"
            >
              다시 로그인
            </LoginLink>
            <button
              type="button"
              className="button"
              onClick={() =>
                window.dispatchEvent(new Event("yebom:check-session"))
              }
            >
              로그인 상태 다시 확인
            </button>
          </div>
        )}
        <fieldset
          disabled={pending || !authorized}
          hidden={!authorized}
          style={authorized ? undefined : { display: "none" }}
        >
          {resuming && (
            <div className="alert">
              <strong>현재 취소된 일정입니다.</strong>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={resumeConfirmed}
                  onChange={(e) => setResumeConfirmed(e.target.checked)}
                  required
                />
                <span>취소를 해제하고 이 일정을 다시 진행합니다</span>
              </label>
            </div>
          )}
          <label className="field">
            <span>
              일정 이름 <b>필수</b>
            </span>
            <input
              autoFocus
              required
              maxLength={120}
              placeholder="예: 온 교회 성탄 축하예배"
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
            />
          </label>
          {!isSingle && (
            <DateExpressionField
              year={
                Number(form.startDate.slice(0, 4)) || Number(date.slice(0, 4))
              }
              onDirtyChange={setDateExpressionDirty}
              onApply={(patch) =>
                setForm((previous) => ({ ...previous, ...patch }))
              }
            />
          )}
          <div className="form-grid">
            <label className="field">
              <span>
                시작 날짜 <b>필수</b>
              </span>
              <input
                type="date"
                required
                value={form.startDate}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    startDate: e.target.value,
                    endDate:
                      p.endDate < e.target.value ? e.target.value : p.endDate,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>마지막 날짜</span>
              <input
                type="date"
                required
                min={form.startDate}
                value={form.endDate}
                onChange={(e) => update("endDate", e.target.value)}
              />
            </label>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(e) =>
                setForm((previous) => ({
                  ...previous,
                  allDay: e.target.checked,
                  startTime: !e.target.checked
                    ? (previous.startTime ?? "09:00")
                    : previous.startTime,
                  endTime: !e.target.checked
                    ? (previous.endTime ?? "10:00")
                    : previous.endTime,
                }))
              }
            />
            <span>시간 없이 하루 종일</span>
          </label>
          {!form.allDay && (
            <div className="form-grid">
              <label className="field">
                <span>시작 시간</span>
                <input
                  type="time"
                  required
                  value={form.startTime ?? "09:00"}
                  onChange={(e) => update("startTime", e.target.value)}
                />
              </label>
              <label className="field">
                <span>마치는 시간</span>
                <input
                  type="time"
                  required
                  value={form.endTime ?? "10:00"}
                  onChange={(e) => update("endTime", e.target.value)}
                />
              </label>
            </div>
          )}
          <label className="field">
            <span>
              주관부서 <b>필수</b>
            </span>
            <select
              disabled={isSingle}
              value={form.organizationId}
              onChange={(e) =>
                update(
                  "organizationId",
                  e.target.value as EventInput["organizationId"],
                )
              }
            >
              {allowed.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.id === "admin" ? " (당회 책임 조직)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label className="field">
              <span>참여 대상</span>
              <select
                disabled={isSingle}
                value={form.audience}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    audience: e.target.value as EventInput["audience"],
                    audienceIds:
                      e.target.value === "all"
                        ? []
                        : p.audienceIds.length
                          ? p.audienceIds
                          : [p.organizationId],
                  }))
                }
              >
                <option value="all">전교회 · 전체 성도</option>
                <option value="departments">선택한 부서</option>
              </select>
            </label>
            <label className="field">
              <span>누구에게 공개하나요?</span>
              <select
                disabled={isSingle}
                value={form.visibility}
                onChange={(e) =>
                  update(
                    "visibility",
                    e.target.value as EventInput["visibility"],
                  )
                }
              >
                <option value="public">전체 공개 · 구글 구독 포함</option>
                <option value="members">로그인 성도에게만</option>
                <option value="department">주관부서 담당자에게만</option>
              </select>
            </label>
          </div>
          {form.audience === "departments" && (
            <div className="audience-picker" aria-label="참여 부서 선택">
              {ORGANIZATIONS.map((o) => (
                <label className="checkbox-row" key={o.id}>
                  <input
                    disabled={isSingle}
                    type="checkbox"
                    checked={form.audienceIds.includes(o.id)}
                    onChange={() =>
                      update(
                        "audienceIds",
                        form.audienceIds.includes(o.id)
                          ? form.audienceIds.filter((id) => id !== o.id)
                          : [...form.audienceIds, o.id],
                      )
                    }
                  />
                  <span>{o.name}</span>
                </label>
              ))}
            </div>
          )}
          <label className="field">
            <span>장소</span>
            {venues.length > 0 && (
              <select
                value={form.locationId ?? ""}
                onChange={(e) => {
                  const venue = venues.find((v) => v.id === e.target.value);
                  setForm((p) => ({
                    ...p,
                    locationId: venue?.id ?? null,
                    location: venue?.name ?? p.location,
                  }));
                }}
              >
                <option value="">직접 입력</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
            <input
              disabled={!!form.locationId}
              placeholder="예: 본당 · 교회 2층 · 온라인"
              maxLength={120}
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
            />
          </label>
          <details className="advanced-fields">
            <summary>
              반복·안내·추가 설정 <ChevronDown size={16} />
            </summary>
            <div>
              {!isSingle && (
                <RecurrenceFields
                  startDate={form.startDate}
                  value={form.recurrence}
                  onChange={(value) => update("recurrence", value)}
                />
              )}
              <label className="field">
                <span>참여자에게 보이는 안내</span>
                <textarea
                  rows={3}
                  maxLength={3000}
                  placeholder="준비물, 찾아오는 방법, 꼭 알아야 할 내용을 적으세요."
                  value={form.description}
                  onChange={(e) => update("description", e.target.value)}
                />
              </label>
              <label className="field">
                <span>담당자 내부 메모</span>
                <textarea
                  rows={2}
                  maxLength={3000}
                  placeholder="공개 화면이나 구글 캘린더에는 표시하지 않아요."
                  value={form.internalNote}
                  onChange={(e) => update("internalNote", e.target.value)}
                />
              </label>
              <label className="field">
                <span>일정 상태</span>
                <select
                  value={form.status}
                  onChange={(e) =>
                    update("status", e.target.value as EventInput["status"])
                  }
                >
                  <option value="confirmed">확정</option>
                  <option value="tentative">예정 · 조정 가능</option>
                </select>
              </label>
            </div>
          </details>
          {event && (
            <label className="field">
              <span>
                {resuming ? "다시 진행하는 이유" : "변경 이유"}{" "}
                <small>{resuming ? "필수" : "선택"}</small>
              </span>
              <input
                required={resuming}
                maxLength={500}
                placeholder="예: 장소 공사로 모임 장소를 변경했어요."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
          <div className="author-note">
            <UserRound size={18} />
            <span>
              입력자 <strong>{actor?.name ?? "로그인 확인 필요"}</strong> ·{" "}
              {event
                ? "최초 입력 기록은 보존하고 변경자를 기록해요."
                : "일정수립일은 서버의 최초 등록일로 자동 기록해요."}
            </span>
          </div>
          {form.visibility === "public" && (
            <p className="muted form-notice">
              안내와 장소가 외부 공유 화면·구글 캘린더에도 표시돼요. 개인정보는
              내부 메모에 적어 주세요.
            </p>
          )}
          {isSingle && (
            <p className="muted">
              반복 주관부서: {organization(form.organizationId).name} · 공개
              범위는 원래 시리즈와 같아요.
            </p>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
        </fieldset>
        <footer className="dialog-actions">
          <button
            type="button"
            className="button"
            disabled={pending}
            onClick={close}
          >
            취소
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={
              pending ||
              !authorized ||
              (resuming && (!resumeConfirmed || !reason.trim()))
            }
          >
            <Save size={18} />
            {pending
              ? "저장하는 중…"
              : resuming
                ? "취소 해제하고 다시 시작"
                : event
                  ? "변경 저장"
                  : "일정 등록"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
