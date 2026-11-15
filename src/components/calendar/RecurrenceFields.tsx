import type { EventInput, RecurrenceRule } from "@/domain/types";

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

export default function RecurrenceFields({
  startDate,
  value,
  onChange,
}: {
  startDate: string;
  value: EventInput["recurrence"];
  onChange: (value: EventInput["recurrence"]) => void;
}) {
  const startWeekday = /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? new Date(`${startDate}T00:00:00Z`).getUTCDay()
    : 0;
  const set = (patch: Partial<RecurrenceRule>) =>
    value && onChange({ ...value, ...patch });
  return (
    <div className="recurrence-fields">
      <label className="field">
        <span>반복</span>
        <select
          value={value?.frequency ?? "none"}
          onChange={(e) =>
            onChange(
              e.target.value === "none"
                ? null
                : {
                    frequency: e.target.value as RecurrenceRule["frequency"],
                    interval: 1,
                    until: `${startDate.slice(0, 4)}-12-31`,
                    ...(e.target.value === "weekly"
                      ? { weekdays: [startWeekday] }
                      : {}),
                  },
            )
          }
        >
          <option value="none">한 번만</option>
          <option value="weekly">매주 · 요일 선택</option>
          <option value="monthly">매월 · 날짜 또는 몇째 요일</option>
          <option value="yearly">매년 같은 날짜</option>
        </select>
      </label>
      {value && (
        <>
          <div className="form-grid">
            <label className="field">
              <span>
                몇{" "}
                {value.frequency === "weekly"
                  ? "주"
                  : value.frequency === "monthly"
                    ? "개월"
                    : "년"}
                마다 하나요?
              </span>
              <input
                type="number"
                min={1}
                max={52}
                value={value.interval}
                onChange={(e) => set({ interval: Number(e.target.value) })}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={value.until === null}
                onChange={(e) =>
                  set({
                    until: e.target.checked
                      ? null
                      : `${startDate.slice(0, 4)}-12-31`,
                  })
                }
              />
              <span>종료일 없이 계속 반복</span>
            </label>
          </div>
          {value.until !== null && (
            <label className="field">
              <span>마지막 모임의 시작 날짜</span>
              <input
                type="date"
                required
                min={startDate}
                value={value.until}
                onChange={(e) => set({ until: e.target.value })}
              />
            </label>
          )}
          {value.frequency === "weekly" && (
            <div className="audience-picker" aria-label="반복 요일">
              {weekdays.map((day, index) => (
                <label className="checkbox-row" key={day}>
                  <input
                    type="checkbox"
                    checked={(value.weekdays ?? [startWeekday]).includes(index)}
                    onChange={() => {
                      const selected = value.weekdays ?? [startWeekday];
                      set({
                        weekdays: selected.includes(index)
                          ? selected.filter((i) => i !== index)
                          : [...selected, index].sort(),
                      });
                    }}
                  />
                  <span>{day}요일</span>
                </label>
              ))}
            </div>
          )}
          {value.frequency === "monthly" && (
            <>
              <label className="field">
                <span>매월 어떤 날인가요?</span>
                <select
                  value={value.monthWeek === undefined ? "date" : "weekday"}
                  onChange={(e) =>
                    onChange(
                      e.target.value === "date"
                        ? {
                            frequency: "monthly",
                            interval: value.interval,
                            until: value.until,
                          }
                        : { ...value, weekdays: [startWeekday], monthWeek: 2 },
                    )
                  }
                >
                  <option value="date">시작 날짜와 같은 일자</option>
                  <option value="weekday">몇째 주의 특정 요일</option>
                </select>
              </label>
              {value.monthWeek !== undefined && (
                <div className="form-grid">
                  <label className="field">
                    <span>몇째인가요?</span>
                    <select
                      value={value.monthWeek}
                      onChange={(e) =>
                        set({ monthWeek: Number(e.target.value) })
                      }
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}번째
                        </option>
                      ))}
                      <option value={-1}>마지막</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>요일</span>
                    <select
                      value={value.weekdays?.[0] ?? startWeekday}
                      onChange={(e) =>
                        set({ weekdays: [Number(e.target.value)] })
                      }
                    >
                      {weekdays.map((day, index) => (
                        <option key={day} value={index}>
                          {day}요일{index === 0 ? " · 주일" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </>
          )}
          <p className="muted">
            {value.until === null
              ? "이 시작 범위부터 종료일 없이 계속돼요. 필요한 기간의 회차만 달력에 표시해요."
              : "이 시작 범위부터 마지막 날짜까지 해당 규칙에 맞는 회차만 표시해요."}{" "}
            실제 첫 모임은 선택한 요일에 시작해요.
          </p>
        </>
      )}
    </div>
  );
}
