import type { EventInput, RecurrenceRule } from "@/domain/types";

export const WEEKDAY_NAMES = [
  "일요일",
  "월요일",
  "화요일",
  "수요일",
  "목요일",
  "금요일",
  "토요일",
];

export default function RecurrenceFields({
  input,
  year,
  onChange,
}: {
  input: EventInput;
  year: number;
  onChange: (patch: Partial<EventInput>) => void;
}) {
  const recurrence = input.recurrence;
  const changeRule = (patch: Partial<RecurrenceRule>) =>
    recurrence && onChange({ recurrence: { ...recurrence, ...patch } });
  return (
    <section className="annual-repeat-fields" aria-label="반복 설정">
      <h3>반복과 날짜 범위</h3>
      <div className="form-grid">
        <label className="field">
          <span>반복 시작 범위 / 행사 시작</span>
          <input
            type="date"
            value={input.startDate}
            onChange={(e) =>
              onChange({
                startDate: e.target.value,
                endDate:
                  !input.endDate || input.endDate < e.target.value
                    ? e.target.value
                    : input.endDate,
              })
            }
          />
        </label>
        <label className="field">
          <span>한 회차 마지막 날짜 (포함)</span>
          <input
            type="date"
            value={input.endDate}
            min={input.startDate}
            onChange={(e) => onChange({ endDate: e.target.value })}
          />
        </label>
      </div>
      <label className="field">
        <span>반복 방식</span>
        <select
          value={recurrence?.frequency ?? "none"}
          onChange={(e) =>
            onChange({
              recurrence:
                e.target.value === "none"
                  ? null
                  : {
                      frequency: e.target.value as RecurrenceRule["frequency"],
                      interval: 1,
                      until: `${year}-12-31`,
                      ...(e.target.value === "weekly" ? { weekdays: [0] } : {}),
                    },
            })
          }
        >
          <option value="none">한 번만</option>
          <option value="weekly">매주 지정 요일</option>
          <option value="monthly">매월 같은 날짜 / 순번 요일</option>
          <option value="yearly">매년 같은 날짜</option>
        </select>
      </label>
      {recurrence && (
        <>
          <label className="field">
            <span>
              반복 간격 (
              {recurrence.frequency === "weekly"
                ? "주"
                : recurrence.frequency === "monthly"
                  ? "개월"
                  : "년"}
              )
            </span>
            <input
              type="number"
              min={1}
              max={12}
              value={recurrence.interval}
              onChange={(e) => changeRule({ interval: Number(e.target.value) })}
            />
          </label>
          {recurrence.frequency === "weekly" && (
            <fieldset className="annual-weekdays">
              <legend>매주 진행하는 요일 (필수)</legend>
              {WEEKDAY_NAMES.map((day, value) => (
                <label className="checkbox-row" key={value}>
                  <input
                    type="checkbox"
                    checked={recurrence.weekdays?.includes(value) ?? false}
                    onChange={() =>
                      changeRule({
                        weekdays: recurrence.weekdays?.includes(value)
                          ? recurrence.weekdays.filter((v) => v !== value)
                          : [...(recurrence.weekdays ?? []), value].sort(),
                      })
                    }
                  />
                  {day}
                </label>
              ))}
            </fieldset>
          )}
          {recurrence.frequency === "monthly" && (
            <div className="form-grid">
              <label className="field">
                <span>매월 날짜 / 순번</span>
                <select
                  value={recurrence.monthWeek ?? "date"}
                  onChange={(e) =>
                    changeRule(
                      e.target.value === "date"
                        ? { monthWeek: undefined, weekdays: undefined }
                        : {
                            monthWeek: Number(e.target.value),
                            weekdays: [recurrence.weekdays?.[0] ?? 0],
                          },
                    )
                  }
                >
                  <option value="date">시작일과 같은 날짜</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}번째
                    </option>
                  ))}
                  <option value={-1}>마지막</option>
                </select>
              </label>
              {recurrence.monthWeek !== undefined && (
                <label className="field">
                  <span>요일</span>
                  <select
                    value={recurrence.weekdays?.[0] ?? 0}
                    onChange={(e) =>
                      changeRule({ weekdays: [Number(e.target.value)] })
                    }
                  >
                    {WEEKDAY_NAMES.map((day, value) => (
                      <option key={value} value={value}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={recurrence.until === null}
              onChange={(e) =>
                changeRule({ until: e.target.checked ? null : `${year}-12-31` })
              }
            />
            종료일 없이 계속 반복
          </label>
          {recurrence.until !== null && (
            <label className="field">
              <span>반복 종료 범위 (포함)</span>
              <input
                type="date"
                min={input.startDate}
                value={recurrence.until}
                onChange={(e) => changeRule({ until: e.target.value })}
              />
            </label>
          )}
          <p className="annual-note">
            시작 범위가 선택 요일과 다르면 그 이후 첫 해당 요일부터 진행해요.
            다섯 번째 요일이 없는 달에는 회차가 없어요. 종료일 없는 일정은{" "}
            <strong>계속 반복</strong>으로 저장해요.
          </p>
        </>
      )}
    </section>
  );
}
