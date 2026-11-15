import { useState } from "react";
import Dialog from "@/components/calendar/Dialog";
import { ORGANIZATIONS, organization } from "@/domain/organizations";
import {
  parseAnnualDate,
  rowToEventInput,
  recurrenceLabel,
} from "@/domain/annual";
import { dateLabel } from "@/domain/calendar";
import type { AnnualPlanRow, EventInput, OrganizationId } from "@/domain/types";
import RecurrenceFields from "./RecurrenceFields";
import { structuredDateText } from "./AnnualTable";
import { proposedFirstDate, proposedInput } from "./rowInput";

const TIME_OPTIONS = Array.from(
  { length: 48 },
  (_, i) =>
    `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

export default function RowDetails({
  row,
  year,
  allowedIds,
  readOnly,
  onClose,
  onApply,
}: {
  row: AnnualPlanRow;
  year: number;
  allowedIds: OrganizationId[];
  readOnly: boolean;
  onClose: () => void;
  onApply: (row: AnnualPlanRow) => void;
}) {
  const [form, setForm] = useState<AnnualPlanRow>(() => {
    return { ...row, input: proposedInput(row, year) };
  });
  const [baseline] = useState(() => JSON.stringify(form));
  const parsed = rowToEventInput(form, year);
  const firstDate = proposedFirstDate(form, year);
  const effective = proposedInput(form, year);
  const update = (patch: Partial<EventInput>) =>
    setForm((p) => ({ ...p, input: { ...p.input, ...patch } }));
  const structured = (patch: Partial<EventInput>) =>
    setForm((p) => {
      const parsedDate = parseAnnualDate(p.dateText, year);
      const input = { ...proposedInput(p, year), ...patch };
      const unconfirmedTime =
        parsedDate.timeAmbiguous && !p.timeConfirmed && !input.allDay;
      const dateText = structuredDateText(input) || p.dateText;
      const [hour, minute] = (parsedDate.startTime ?? "00:00")
        .split(":")
        .map(Number);
      const ambiguousSuffix = `${hour}시${minute ? `${minute}분` : ""}`;
      return {
        ...p,
        input,
        dateText:
          unconfirmedTime && parsedDate.startTime
            ? `${dateText} ${ambiguousSuffix}`
            : dateText,
      };
    });
  const chooseTime = (patch: Partial<EventInput>) => {
    if (
      parseAnnualDate(form.dateText, year).timeAmbiguous &&
      !form.timeConfirmed
    ) {
      setForm((p) => ({
        ...p,
        input: { ...p.input, ...patch },
        timeConfirmed: false,
      }));
    } else {
      structured(patch);
      setForm((p) => ({ ...p, timeConfirmed: false }));
    }
  };
  const close = () => {
    if (
      readOnly ||
      JSON.stringify(form) === baseline ||
      window.confirm(
        "이 행의 변경을 적용하지 않고 닫을까요? 입력표의 원래 행은 그대로 유지됩니다.",
      )
    )
      onClose();
  };
  return (
    <Dialog
      wide
      title={readOnly ? "등록한 계획 설정" : "이 일정의 추가 설정"}
      description="주관부서·참여 대상·공개 범위는 서로 다른 설정입니다. 날짜 해석은 적용 전 미리 확인하세요."
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onApply(form);
          onClose();
        }}
        className="annual-dialog"
      >
        <fieldset disabled={readOnly} className="annual-fieldset dialog-body">
          <label className="field">
            <span>일정 이름</span>
            <input
              value={form.input.title}
              maxLength={120}
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>날짜 표현 · 원문</span>
            <input
              value={form.dateText}
              maxLength={500}
              placeholder="10/10부터 계속 수요일 오후8시"
              onChange={(e) =>
                setForm((p) => {
                  const next = {
                    ...p,
                    dateText: e.target.value,
                    timeConfirmed: false,
                  };
                  return { ...next, input: proposedInput(next, year) };
                })
              }
            />
            <small>
              예: 10/10, 10/10~10/12, 날짜 미정, 10/10부터 계속 수요일 오후8시
            </small>
          </label>
          <div className="annual-parse-box" aria-live="polite">
            {parsed.undated ? (
              <strong>날짜 미정 · 초안에만 보관</strong>
            ) : firstDate ? (
              <>
                <strong>
                  실제 첫 일정: {dateLabel(firstDate)}
                  {parsed.errors.length ? " (등록 전 확인 필요)" : ""}
                </strong>
                <p>
                  {recurrenceLabel(effective)}
                  {!effective.allDay &&
                    ` · ${effective.startTime ?? "시간 확인 필요"}`}
                </p>
              </>
            ) : (
              <strong>날짜 / 필수 정보를 확인해 주세요</strong>
            )}
            {parsed.errors.map((error, i) => (
              <p className="annual-error-text" key={i}>
                {error}
              </p>
            ))}
            {parsed.warnings.map((warning, i) => (
              <p key={i}>{warning}</p>
            ))}
          </div>
          <section className="annual-time-confirmation">
            <h3>시간 확인</h3>
            <p>
              ‘8시’는 오전인지 오후인지 알 수 없어요. 실제 시작 시각을 선택하고
              확인해 주세요. 모든 시각은 한국시간입니다.
            </p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.input.allDay}
                onChange={(e) =>
                  structured({
                    allDay: e.target.checked,
                    startTime: e.target.checked
                      ? null
                      : (form.input.startTime ?? "09:00"),
                    endTime: e.target.checked
                      ? null
                      : (form.input.endTime ?? "10:00"),
                  })
                }
              />
              시간 없이 종일
            </label>
            <div className="form-grid">
              <label className="field">
                <span>실제 시작 시각 선택</span>
                <select
                  value={form.input.startTime ?? ""}
                  onChange={(e) =>
                    chooseTime({
                      allDay: false,
                      startTime: e.target.value || null,
                    })
                  }
                >
                  <option value="">시각 선택</option>
                  {form.input.startTime &&
                    !TIME_OPTIONS.includes(form.input.startTime) && (
                      <option value={form.input.startTime}>
                        {form.input.startTime}
                      </option>
                    )}
                  {TIME_OPTIONS.map((time) => (
                    <option value={time} key={time}>
                      {time} ({Number(time.slice(0, 2)) < 12 ? "오전" : "오후"})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>종료 시각</span>
                <input
                  type="time"
                  value={form.input.endTime ?? ""}
                  onChange={(e) =>
                    chooseTime({ endTime: e.target.value || null })
                  }
                />
              </label>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.timeConfirmed === true}
                disabled={!form.input.startTime || form.input.allDay}
                onChange={(e) =>
                  setForm((p) => {
                    const next = { ...p, timeConfirmed: e.target.checked };
                    const input = proposedInput(next, year);
                    return {
                      ...next,
                      input,
                      dateText: e.target.checked
                        ? structuredDateText(input) || p.dateText
                        : p.dateText,
                    };
                  })
                }
              />
              선택한 시작 시각의 오전/오후를 확인했어요
            </label>
          </section>
          <label className="field">
            <span>이 행의 주관부서</span>
            <select
              value={form.input.organizationId}
              onChange={(e) =>
                update({ organizationId: e.target.value as OrganizationId })
              }
            >
              {ORGANIZATIONS.filter(
                (o) =>
                  allowedIds.includes(o.id) ||
                  o.id === form.input.organizationId,
              ).map((o) => (
                <option
                  disabled={!allowedIds.includes(o.id)}
                  value={o.id}
                  key={o.id}
                >
                  {o.name}
                  {o.id === "admin" ? " (책임 조직: 당회)" : ""}
                </option>
              ))}
            </select>
            <small>
              왼쪽 입력 부서를 바꿔도 이미 작성한 행의 부서는 바뀌지 않아요.
            </small>
          </label>
          <div className="form-grid">
            <label className="field">
              <span>참여 대상</span>
              <select
                value={form.input.audience}
                onChange={(e) =>
                  update({
                    audience: e.target.value as EventInput["audience"],
                    audienceIds:
                      e.target.value === "all"
                        ? []
                        : form.input.audienceIds.length
                          ? form.input.audienceIds
                          : [form.input.organizationId],
                  })
                }
              >
                <option value="departments">선택한 부서</option>
                <option value="all">전교회 · 전체 성도</option>
              </select>
            </label>
            <label className="field">
              <span>공개 범위</span>
              <select
                value={form.input.visibility}
                onChange={(e) =>
                  update({
                    visibility: e.target.value as EventInput["visibility"],
                  })
                }
              >
                <option value="members">로그인 성도에게만 (기본)</option>
                <option value="department">주관부서 담당자에게만</option>
                <option value="public">전체 공개 · 구글 구독 포함</option>
              </select>
            </label>
          </div>
          {form.input.audience === "departments" && (
            <fieldset className="annual-audience">
              <legend>참여 부서</legend>
              {ORGANIZATIONS.map((o) => (
                <label className="checkbox-row" key={o.id}>
                  <input
                    type="checkbox"
                    checked={form.input.audienceIds.includes(o.id)}
                    onChange={() =>
                      update({
                        audienceIds: form.input.audienceIds.includes(o.id)
                          ? form.input.audienceIds.filter((id) => id !== o.id)
                          : [...form.input.audienceIds, o.id],
                      })
                    }
                  />
                  {o.name}
                </label>
              ))}
            </fieldset>
          )}
          <p className="annual-note">
            현재: {organization(form.input.organizationId).name} 주관 ·{" "}
            {form.input.audience === "all" ? "전교회 대상" : "선택 부서 대상"}.
            내부 메모는 공개 화면과 구글 구독에 포함하지 않아요.
          </p>
          {form.input.visibility === "public" && (
            <div className="alert">
              장소와 참여자 안내가 외부에도 공개됩니다. 개인정보는 내부 메모에만
              적어 주세요.
            </div>
          )}
          <RecurrenceFields
            input={form.input}
            year={year}
            onChange={structured}
          />
          <label className="field">
            <span>참여자 안내</span>
            <textarea
              rows={3}
              maxLength={3000}
              value={form.input.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </label>
          <label className="field">
            <span>담당자 내부 메모</span>
            <textarea
              rows={3}
              maxLength={3000}
              value={form.input.internalNote}
              onChange={(e) => update({ internalNote: e.target.value })}
            />
          </label>
          <label className="field">
            <span>일정 상태</span>
            <select
              value={form.input.status}
              onChange={(e) =>
                update({ status: e.target.value as EventInput["status"] })
              }
            >
              <option value="confirmed">확정</option>
              <option value="tentative">예정 · 조정 가능</option>
            </select>
          </label>
        </fieldset>
        <footer className="dialog-actions">
          <button type="button" className="button" onClick={close}>
            {readOnly ? "닫기" : "취소"}
          </button>
          {!readOnly && (
            <button type="submit" className="button primary">
              이 행에 적용
            </button>
          )}
        </footer>
      </form>
    </Dialog>
  );
}
