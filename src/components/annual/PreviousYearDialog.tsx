import { useEffect, useMemo, useState } from "react";
import Dialog from "@/components/calendar/Dialog";
import { api } from "@/components/calendar/api";
import {
  copyEventToAnnualRow,
  recurrenceLabel,
  rowToEventInput,
} from "@/domain/annual";
import { canReadEvent } from "@/domain/permissions";
import { dateLabel, timeLabel } from "@/domain/calendar";
import { organization } from "@/domain/organizations";
import type {
  Actor,
  AnnualPlanRow,
  Bootstrap,
  CalendarEvent,
  OrganizationId,
} from "@/domain/types";

export default function PreviousYearDialog({
  targetYear,
  organizationId,
  actor,
  onClose,
  onAppend,
}: {
  targetYear: number;
  organizationId: OrganizationId;
  actor: Actor;
  onClose: () => void;
  onAppend: (rows: AnnualPlanRow[]) => void;
}) {
  const [sourceYear, setSourceYear] = useState(targetYear - 1);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [allDepartments, setAllDepartments] = useState(false);
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [includeOpen, setIncludeOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let active = true;
    api<Bootstrap>(`/api/bootstrap?year=${sourceYear}`)
      .then((data) => {
        if (active) {
          setBoot(data);
          setError("");
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(
            e instanceof Error ? e.message : "지난 일정을 읽지 못했어요.",
          );
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [sourceYear]);
  const events = useMemo(
    () =>
      (boot?.events ?? [])
        .filter(
          (event) =>
            canReadEvent(event, boot?.actor ?? null) &&
            canReadEvent(event, actor) &&
            !event.deleted &&
            (includeCancelled || event.status !== "cancelled") &&
            (includeOpen ||
              !event.recurrence ||
              event.recurrence.until !== null) &&
            (allDepartments || event.organizationId === organizationId),
        )
        .sort(
          (a, b) =>
            a.startDate.localeCompare(b.startDate) ||
            a.title.localeCompare(b.title, "ko"),
        ),
    [
      boot,
      actor,
      includeCancelled,
      includeOpen,
      allDepartments,
      organizationId,
    ],
  );
  const chosen = events.filter((event) => selected.includes(event.id));
  const copied = useMemo(
    () =>
      chosen.map((event) => {
        const row = copyEventToAnnualRow(event, targetYear, organizationId);
        const parsed = rowToEventInput(row, targetYear);
        return { event, row, parsed };
      }),
    [chosen, targetYear, organizationId],
  );
  const reset = () => {
    setSelected([]);
    setConfirmed(false);
  };
  const toggle = (event: CalendarEvent) => {
    setSelected((p) =>
      p.includes(event.id)
        ? p.filter((id) => id !== event.id)
        : [...p, event.id],
    );
    setConfirmed(false);
  };
  return (
    <Dialog
      wide
      title="지난해 활동 가져오기"
      description="실제 열람 가능한 일정만 읽습니다. 새로운 행 ID로 복사하고 날짜·요일·교회력을 다시 검토하세요."
      onClose={onClose}
    >
      <div className="annual-dialog dialog-body">
        <label className="field">
          <span>원본 연도</span>
          <select
            value={sourceYear}
            onChange={(e) => {
              setSourceYear(Number(e.target.value));
              setLoading(true);
              setBoot(null);
              reset();
            }}
          >
            {Array.from({ length: 101 }, (_, i) => 2000 + i)
              .filter((y) => y < targetYear)
              .map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
          </select>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={allDepartments}
            onChange={(e) => {
              setAllDepartments(e.target.checked);
              reset();
            }}
          />
          열람 가능한 다른 부서 활동도 보기
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={includeCancelled}
            onChange={(e) => {
              setIncludeCancelled(e.target.checked);
              reset();
            }}
          />
          취소 활동도 검토 (복사 후 상태 재확인)
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={includeOpen}
            onChange={(e) => {
              setIncludeOpen(e.target.checked);
              reset();
            }}
          />
          종료일 없는 계속 반복도 검토 (이미 진행 중인 시리즈와 중복 주의)
        </label>
        <p className="annual-note">
          기본적으로 취소·삭제·계속 반복은 제외해요. 삭제 일정은 가져오지
          않습니다. 주관부서는 {organization(organizationId).name}로 복사합니다.
          감사 기록·작성자·수립일·회차 예외는 복사하지 않아요.
        </p>
        {loading ? (
          <p role="status">{sourceYear}년 실제 일정을 읽는 중…</p>
        ) : error ? (
          <div className="alert error" role="alert">
            {error}
          </div>
        ) : (
          <>
            {events.length === 0 && (
              <p>이 조건으로 가져올 수 있는 실제 일정이 없어요.</p>
            )}
            <div className="annual-source-list">
              {events.map((event) => (
                <label className="annual-source-row" key={event.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(event.id)}
                    onChange={() => toggle(event)}
                  />
                  <span>
                    <strong>{event.title}</strong>
                    <small>
                      {dateLabel(event.startDate)} · {timeLabel(event)} ·{" "}
                      {organization(event.organizationId).name}
                    </small>
                    <small>
                      {recurrenceLabel(event)}
                      {event.status === "cancelled" ? " · 취소 상태" : ""}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        {!!copied.length && (
          <section className="annual-copy-preview">
            <h3>
              {targetYear}년 복사 미리보기 ({copied.length}개)
            </h3>
            <p className="alert">
              요일과 부활절 등 이동 절기는 연도마다 달라요. 날짜는 자동으로 절기
              날짜에 맞추지 않습니다. 2월 29일이 없는 해에는 보정하지 않고
              오류로 남겨요.
            </p>
            {copied.map(({ event, row, parsed }) => (
              <article key={event.id}>
                <strong>{row.input.title}</strong>
                <p>
                  {event.startDate} → {row.dateText} · 요일 / 교회력 재확인
                </p>
                {parsed.errors.map((e, i) => (
                  <p className="annual-error-text" key={i}>
                    {e}
                  </p>
                ))}
                {parsed.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
                {event.recurrence?.until === null && (
                  <p>
                    계속 반복 원본이 아직 진행 중일 수 있어요. 중복 등록하지
                    않도록 확인하세요.
                  </p>
                )}
              </article>
            ))}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              날짜·요일·절기와 중복 가능성을 다시 확인해야 함을 이해했어요
            </label>
          </section>
        )}
      </div>
      <footer className="dialog-actions">
        <button className="button" onClick={onClose}>
          닫기
        </button>
        <button
          className="button primary"
          disabled={loading || !!error || !copied.length || !confirmed}
          onClick={() => {
            onAppend(copied.map((p) => p.row));
            onClose();
          }}
        >
          {copied.length}개 활동을 초안에 복사
        </button>
      </footer>
    </Dialog>
  );
}
