import { useEffect, useState } from "react";
import {
  CalendarDays,
  MapPin,
  UsersRound,
  Pencil,
  History,
  Ban,
  Trash2,
} from "lucide-react";
import type {
  Actor,
  CalendarEvent,
  ChangeRecord,
  Occurrence,
} from "@/domain/types";
import { organization } from "@/domain/organizations";
import { canEditEvent } from "@/domain/permissions";
import { dateLabel, timeLabel, occurrenceForDate } from "@/domain/calendar";
import Dialog from "./Dialog";
import { api } from "./api";
import type { EditScope } from "./EventEditor";
export function stamp(value: string | null) {
  if (!value) return "아직 변경 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
export const fieldNames: Record<string, string> = {
  title: "일정 이름",
  startDate: "시작 날짜",
  endDate: "마지막 날짜",
  startTime: "시작 시간",
  endTime: "마치는 시간",
  location: "장소",
  locationId: "장소",
  organizationId: "주관부서",
  visibility: "공개 범위",
  audience: "참여 대상",
  audienceIds: "참여 부서",
  description: "안내",
  internalNote: "내부 메모",
  recurrence: "반복",
  status: "일정 상태",
  deleted: "삭제 상태",
  exceptions: "개별 회차",
  allDay: "종일 여부",
  cancelReason: "취소 이유",
};
export const kindNames: Record<string, string> = {
  create: "일정 수립",
  update: "일정 변경",
  cancel: "일정 취소",
  delete: "휴지통 이동",
  restore: "일정 복구",
  occurrence_update: "이번 회차 변경",
  occurrence_cancel: "이번 회차 취소",
  "update-occurrence": "이번 회차 변경",
  "cancel-occurrence": "이번 회차 취소",
  "uncancel-occurrence": "이번 회차 다시 시작",
  uncancel: "일정 다시 시작",
};

function changeValues(change: ChangeRecord) {
  if (!change.before || !change.after) return [];
  let before = change.before;
  let after = change.after;
  if (change.occurrenceDate) {
    try {
      before = occurrenceForDate(
        before as unknown as CalendarEvent,
        change.occurrenceDate,
      ) as unknown as Record<string, unknown>;
      after = occurrenceForDate(
        after as unknown as CalendarEvent,
        change.occurrenceDate,
      ) as unknown as Record<string, unknown>;
    } catch {
      return [];
    }
  }
  return ["title", "startDate", "endDate", "startTime", "endTime", "location"]
    .filter((field) => before[field] !== after[field])
    .map((field) => ({
      field,
      before: String(before[field] ?? "미정"),
      after: String(after[field] ?? "미정"),
    }));
}

export default function EventDetail({
  event,
  actor,
  publicMode,
  onClose,
  onEdit,
  onAction,
}: {
  event: Occurrence;
  actor: Actor | null;
  publicMode: boolean;
  onClose: () => void;
  onEdit: (scope: EditScope) => void;
  onAction: (action: "cancel" | "delete") => void;
}) {
  const [history, setHistory] = useState<ChangeRecord[]>([]);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<EditScope>(
    event.recurrence && !(event.status === "cancelled" && !event.isException)
      ? "single"
      : "series",
  );
  useEffect(() => {
    let active = true;
    api<{ history: ChangeRecord[] }>(
      `/api/events/${event.id}${publicMode ? "?public=1" : ""}`,
    )
      .then((data) => {
        if (active) setHistory(data.history);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [event.id, publicMode]);
  const org = organization(event.organizationId);
  const editable = !publicMode && canEditEvent(event, actor);
  return (
    <Dialog title="일정 자세히 보기" onClose={onClose}>
      <div className="detail-body">
        <div className="detail-badges">
          <span style={{ color: org.color, background: org.light }}>
            {org.name}
          </span>
          <span>
            {event.status === "cancelled"
              ? "취소"
              : event.status === "tentative"
                ? "예정"
                : "확정"}
          </span>
          {event.recurrence && (
            <span>{event.isException ? "변경된 회차" : "반복 일정"}</span>
          )}
        </div>
        <h2 className="event-title">{event.title}</h2>
        <dl className="detail-facts">
          <div>
            <dt>
              <CalendarDays size={18} />
              언제
            </dt>
            <dd>
              {dateLabel(event.startDate)}
              {event.endDate !== event.startDate &&
                ` ~ ${dateLabel(event.endDate)}`}
              <strong>{timeLabel(event)}</strong>
            </dd>
          </div>
          <div>
            <dt>
              <MapPin size={18} />
              어디서
            </dt>
            <dd>{event.location || "장소 미정"}</dd>
          </div>
          <div>
            <dt>
              <UsersRound size={18} />
              참여 대상
            </dt>
            <dd>
              {event.audience === "all"
                ? "전교회 · 전체 성도"
                : event.audienceIds
                    .map((id) => organization(id).name)
                    .join(" · ") || "주관부서"}
            </dd>
          </div>
          <div>
            <dt>주관부서</dt>
            <dd>
              {org.name}
              {org.id === "admin" && <small>예산 책임 조직 원본: 당회</small>}
            </dd>
          </div>
          <div>
            <dt>공개 범위</dt>
            <dd>
              {event.visibility === "public"
                ? "전체 공개 · 구글 구독 포함"
                : event.visibility === "members"
                  ? "로그인 성도에게만"
                  : "주관부서 담당자에게만"}
            </dd>
          </div>
        </dl>
        {event.description && (
          <div className="event-description">{event.description}</div>
        )}
        {event.internalNote && editable && (
          <section className="internal-note">
            <h3>담당자 내부 메모</h3>
            <p>{event.internalNote}</p>
          </section>
        )}
        {event.status === "cancelled" && (
          <div className="alert">
            취소된 일정 · {event.cancelReason || "담당자에게 확인해 주세요."}
          </div>
        )}
        <section className="records">
          <h3>
            <History size={18} />
            일정 수립·변경 기록
          </h3>
          {event.createdBy ? (
            <dl>
              <div>
                <dt>일정수립일</dt>
                <dd>{stamp(event.createdAt)}</dd>
              </div>
              <div>
                <dt>입력자</dt>
                <dd>{event.createdBy.name}</dd>
              </div>
              <div>
                <dt>최종 변경일</dt>
                <dd>{stamp(event.updatedAt)}</dd>
              </div>
              <div>
                <dt>변경자</dt>
                <dd>{event.updatedBy?.name ?? "아직 변경 없음"}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">
              작성자 이름과 담당자 기록은 로그인 후 확인할 수 있어요. 구글
              구독에는 개인정보를 싣지 않아요.
            </p>
          )}
          <p className="muted">
            일정수립일은 최초 등록일이에요. 수정해도 최초 기록은 보존돼요.
          </p>
          {!!history.length && (
            <details>
              <summary>변경 이력 {history.length}건</summary>
              <ol className="history-list">
                {history.map((change) => (
                  <li key={change.id}>
                    <strong>{kindNames[change.kind] ?? "일정 변경"}</strong>
                    <span>
                      {stamp(change.at)}
                      {change.by && ` · ${change.by.name}`}
                    </span>
                    {change.changedFields.length > 0 && (
                      <p>
                        {change.changedFields
                          .map((f) => fieldNames[f] ?? f)
                          .join(" · ")}
                      </p>
                    )}
                    {change.reason && <p>{change.reason}</p>}
                    {change.before && change.after && (
                      <div className="change-values">
                        {changeValues(change).map((value) => (
                          <small key={value.field}>
                            {fieldNames[value.field]}: {value.before} →{" "}
                            {value.after}
                          </small>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          )}
          {error && (
            <p className="alert error">기록을 불러오지 못했어요. {error}</p>
          )}
        </section>
      </div>
      <footer className="dialog-actions detail-actions">
        {editable && (
          <>
            {event.recurrence && (
              <select
                aria-label="수정 적용 범위"
                value={scope}
                onChange={(e) => setScope(e.target.value as EditScope)}
              >
                {!(event.status === "cancelled" && !event.isException) && (
                  <option value="single">이번 회차</option>
                )}
                <option value="series">반복 전체</option>
              </select>
            )}
            <button className="button" onClick={() => onAction("cancel")}>
              <Ban size={17} />
              취소 처리
            </button>
            <button
              className="icon-button danger"
              aria-label="휴지통으로 이동"
              onClick={() => onAction("delete")}
            >
              <Trash2 size={18} />
            </button>
            <button className="button primary" onClick={() => onEdit(scope)}>
              <Pencil size={17} />
              {event.status === "cancelled" ? "다시 시작" : "수정"}
            </button>
          </>
        )}
        <button className="button" onClick={onClose}>
          닫기
        </button>
      </footer>
    </Dialog>
  );
}
