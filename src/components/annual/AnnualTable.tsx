import { Plus, SlidersHorizontal, Trash2, ExternalLink } from "lucide-react";
import {
  parseAnnualDate,
  rowToEventInput,
  recurrenceLabel,
} from "@/domain/annual";
import { dateLabel, timeLabel } from "@/domain/calendar";
import { organization } from "@/domain/organizations";
import type {
  AnnualPlanRow,
  EventInput,
  OrganizationId,
  Venue,
} from "@/domain/types";
import { proposedFirstDate, proposedInput } from "./rowInput";

export function structuredDateText(input: EventInput): string {
  if (!input.startDate) return "";
  return input.endDate && input.endDate !== input.startDate
    ? `${input.startDate}~${input.endDate}`
    : input.startDate;
}

export function changeStructured(
  row: AnnualPlanRow,
  patch: Partial<EventInput>,
  year: number,
): AnnualPlanRow {
  const parsed = rowToEventInput(row, year);
  const input = { ...(parsed.input ?? proposedInput(row, year)), ...patch };
  const ambiguous =
    parseAnnualDate(row.dateText, year).timeAmbiguous && !row.timeConfirmed;
  const timeOnly = Object.keys(patch).every((key) =>
    ["allDay", "startTime", "endTime"].includes(key),
  );
  return {
    ...row,
    input,
    dateText:
      ambiguous && timeOnly && patch.allDay !== true
        ? row.dateText
        : structuredDateText(input) || row.dateText,
  };
}

export default function AnnualTable({
  rows,
  year,
  venues,
  newRowOrganizationId,
  canAdd,
  publishedRowIds,
  disabled,
  onChange,
  onDelete,
  onDetails,
  onAdd,
  onSaveNext,
}: {
  rows: AnnualPlanRow[];
  year: number;
  venues: Venue[];
  newRowOrganizationId: OrganizationId | "";
  canAdd: boolean;
  publishedRowIds: string[];
  disabled: boolean;
  onChange: (row: AnnualPlanRow) => void;
  onDelete: (id: string) => void;
  onDetails: (id: string) => void;
  onAdd: () => void;
  onSaveNext: () => void;
}) {
  return (
    <div className="annual-table-section">
      <table className="annual-table">
        <caption className="annual-sr-only">
          {year}년 연간계획. 입력 중에는 행 순서가 바뀌지 않습니다.
        </caption>
        <thead>
          <tr>
            <th scope="col">날짜 표현</th>
            <th scope="col">일정 이름</th>
            <th scope="col">종일 / 시간</th>
            <th scope="col">장소</th>
            <th scope="col">추가 설정</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const parsed = rowToEventInput(row, year);
            const published = publishedRowIds.includes(row.id);
            const locked = disabled || published;
            const effective = proposedInput(row, year);
            const firstDate = proposedFirstDate(row, year);
            const update = (patch: Partial<EventInput>) =>
              onChange({ ...row, input: { ...row.input, ...patch } });
            const preview = parsed.undated
              ? "날짜 미정 · 초안에만 보관"
              : firstDate
                ? `첫 일정: ${dateLabel(firstDate)} · ${timeLabel(effective)}${parsed.errors.length ? " (등록 전 확인 필요)" : ""}`
                : "날짜 표현과 필수 정보를 확인해 주세요";
            return (
              <tr key={row.id} className={published ? "annual-published" : ""}>
                <td data-label="날짜 표현">
                  <div className="annual-row-number">
                    {index + 1}행{" "}
                    {published && (
                      <span className="annual-badge">등록 완료</span>
                    )}
                    {newRowOrganizationId &&
                      row.input.organizationId !== newRowOrganizationId && (
                        <span className="annual-badge">
                          이 행 주관:{" "}
                          {organization(row.input.organizationId).name}
                        </span>
                      )}
                  </div>
                  <label
                    className="annual-sr-only"
                    htmlFor={`annual-date-${row.id}`}
                  >
                    {index + 1}행 날짜 표현
                  </label>
                  <input
                    id={`annual-date-${row.id}`}
                    placeholder="예: 10/10 · 날짜 미정"
                    value={row.dateText}
                    disabled={locked}
                    maxLength={500}
                    onChange={(e) =>
                      onChange({
                        ...row,
                        dateText: e.target.value,
                        timeConfirmed: false,
                      })
                    }
                  />
                  <div
                    className="annual-preview"
                    id={`annual-preview-${row.id}`}
                  >
                    {preview}
                  </div>
                  {effective.recurrence && (
                    <span className="annual-badge">
                      {recurrenceLabel(effective)}
                    </span>
                  )}
                  {!!parsed.errors.length && !published && (
                    <ul className="annual-row-errors">
                      {parsed.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  )}
                  {!!parsed.warnings.length && (
                    <ul className="annual-row-warnings">
                      {parsed.warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td data-label="일정 이름">
                  <label
                    className="annual-sr-only"
                    htmlFor={`annual-title-${row.id}`}
                  >
                    {index + 1}행 일정 이름
                  </label>
                  <input
                    id={`annual-title-${row.id}`}
                    placeholder="무슨 활동을 하나요?"
                    value={row.input.title}
                    disabled={locked}
                    maxLength={120}
                    onChange={(e) => update({ title: e.target.value })}
                  />
                  <p className="annual-scope">
                    {organization(row.input.organizationId).name} ·{" "}
                    {row.input.audience === "all"
                      ? "전교회 대상"
                      : row.input.audienceIds
                          .map((id) => organization(id).name)
                          .join(", ") || "참여 부서 미선택"}
                    <br />
                    {row.input.visibility === "public"
                      ? "전체 공개 · 구글 구독 포함"
                      : row.input.visibility === "members"
                        ? "로그인 성도 공개"
                        : "주관부서 담당자 공개"}
                  </p>
                </td>
                <td data-label="종일 / 시간">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={effective.allDay}
                      disabled={locked}
                      onChange={(e) =>
                        onChange(
                          changeStructured(
                            row,
                            {
                              allDay: e.target.checked,
                              startTime: e.target.checked
                                ? null
                                : (effective.startTime ?? "09:00"),
                              endTime: e.target.checked
                                ? null
                                : (effective.endTime ?? "10:00"),
                            },
                            year,
                          ),
                        )
                      }
                    />
                    종일
                  </label>
                  {!effective.allDay && (
                    <div className="annual-times">
                      <label>
                        시작
                        <input
                          type="time"
                          aria-label={`${index + 1}행 시작 시간`}
                          disabled={locked}
                          value={effective.startTime ?? ""}
                          onChange={(e) =>
                            onChange({
                              ...changeStructured(
                                row,
                                {
                                  allDay: false,
                                  startTime: e.target.value || null,
                                },
                                year,
                              ),
                              timeConfirmed: false,
                            })
                          }
                        />
                      </label>
                      <label>
                        종료
                        <input
                          type="time"
                          aria-label={`${index + 1}행 종료 시간`}
                          disabled={locked}
                          value={effective.endTime ?? ""}
                          onChange={(e) =>
                            onChange(
                              changeStructured(
                                row,
                                { endTime: e.target.value || null },
                                year,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                  )}
                  {!published && (
                    <label className="checkbox-row annual-confirm-time">
                      <input
                        type="checkbox"
                        checked={row.timeConfirmed === true}
                        disabled={
                          locked || !effective.startTime || effective.allDay
                        }
                        onChange={(e) =>
                          onChange({
                            ...row,
                            input: effective,
                            dateText: e.target.checked
                              ? structuredDateText(effective) || row.dateText
                              : row.dateText,
                            timeConfirmed: e.target.checked,
                          })
                        }
                      />
                      <span>시작 시각(오전/오후)을 확인했어요</span>
                    </label>
                  )}
                  {!published && (
                    <button
                      className="text-button"
                      disabled={locked}
                      onClick={() => onDetails(row.id)}
                    >
                      모호한 시간 확인
                    </button>
                  )}
                </td>
                <td data-label="장소">
                  {venues.length > 0 && (
                    <select
                      aria-label={`${index + 1}행 등록 장소`}
                      disabled={locked}
                      value={row.input.locationId ?? ""}
                      onChange={(e) => {
                        const venue = venues.find(
                          (v) => v.id === e.target.value,
                        );
                        update({
                          locationId: venue?.id ?? null,
                          location: venue?.name ?? row.input.location,
                        });
                      }}
                    >
                      <option value="">직접 입력 / 장소 미정</option>
                      {venues.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    aria-label={`${index + 1}행 장소`}
                    placeholder="선택 입력"
                    disabled={locked || !!row.input.locationId}
                    maxLength={120}
                    value={row.input.location}
                    onChange={(e) => update({ location: e.target.value })}
                  />
                </td>
                <td data-label="추가 설정" className="annual-row-actions">
                  <button
                    className="button"
                    disabled={disabled}
                    onClick={() => onDetails(row.id)}
                  >
                    <SlidersHorizontal size={16} />
                    {published ? "설정 보기" : "추가 설정"}
                  </button>
                  {published ? (
                    <a
                      className="text-button"
                      href={`/?year=${year}&view=list&event=${encodeURIComponent(row.id)}`}
                    >
                      <ExternalLink size={16} />
                      원본 일정
                    </a>
                  ) : (
                    <button
                      className="text-button annual-delete"
                      disabled={locked}
                      onClick={() => onDelete(row.id)}
                    >
                      <Trash2 size={16} />행 삭제
                    </button>
                  )}
                  {!published && (
                    <button
                      className="button primary annual-save-next"
                      disabled={locked || !canAdd}
                      onClick={onSaveNext}
                    >
                      저장하고 다음 일정
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="annual-empty">
          <h2>올해 계획을 한 줄씩 적어 보세요</h2>
          <p>
            날짜와 이름부터 적으세요. 날짜가 정해지지 않은 활동도 초안으로
            저장할 수 있어요.
          </p>
        </div>
      )}
      <button
        className="button annual-add-next"
        disabled={disabled || !canAdd}
        onClick={onAdd}
      >
        <Plus size={18} />
        다음 일정 한 줄 추가
      </button>
    </div>
  );
}
