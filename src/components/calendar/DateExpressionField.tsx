import { useState } from "react";
import { parseAnnualDate } from "@/domain/annual";
import { addDaysISO } from "@/domain/calendar";
import type { EventInput } from "@/domain/types";

export default function DateExpressionField({
  year,
  onApply,
  onDirtyChange,
}: {
  year: number;
  onApply: (patch: Partial<EventInput>) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [message, setMessage] = useState("");
  const parsed = parseAnnualDate(text, year);
  const canApply =
    parsed.kind === "dated" &&
    parsed.errors.length === 0 &&
    (!parsed.timeAmbiguous || selectedTime !== "");
  const baseHour = Number(parsed.startTime?.slice(0, 2) ?? 0) % 12;
  const minutes = parsed.startTime?.slice(3) ?? "00";
  const choices = [baseHour, baseHour + 12].map((hour, index) => ({
    value: `${String(hour).padStart(2, "0")}:${minutes}`,
    label: `${index === 0 ? "오전" : "오후"} ${baseHour || 12}시${minutes !== "00" ? ` ${minutes}분` : ""}`,
  }));
  const apply = () => {
    if (!canApply || !parsed.startDate || !parsed.endDate) return;
    const patch: Partial<EventInput> = {
      startDate: parsed.startDate,
      endDate: parsed.endDate,
    };
    if (parsed.dateKind === "recurrence") patch.recurrence = parsed.recurrence;
    if (parsed.hasTime) {
      patch.allDay = parsed.allDay ?? true;
      patch.startTime = parsed.timeAmbiguous ? selectedTime : parsed.startTime;
      patch.endTime = parsed.endTime;
      if (parsed.timeAmbiguous && patch.startTime) {
        const [hours, minute] = patch.startTime.split(":").map(Number);
        const total = hours * 60 + minute + 60;
        patch.endTime = `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
        patch.endDate = addDaysISO(
          parsed.endDate,
          Math.floor(total / 1440) - parsed.endDayOffset,
        );
      }
    }
    onApply(patch);
    setText("");
    setSelectedTime("");
    onDirtyChange(false);
    setMessage(
      "날짜와 반복 설정에 적용했어요. 시작·종료 시간을 확인해 주세요.",
    );
  };
  return (
    <details className="advanced-fields date-expression">
      <summary>날짜를 문장으로 적기 · 정기모임도 가능</summary>
      <div>
        <label className="field">
          <span>날짜 표현 · 연도 없는 날짜는 {year}년</span>
          <input
            value={text}
            maxLength={500}
            placeholder="10/10부터 계속 수요일8시"
            onChange={(e) => {
              setText(e.target.value);
              setSelectedTime("");
              setMessage("");
              onDirtyChange(e.target.value.trim() !== "");
            }}
          />
        </label>
        <small className="muted">
          예: 7/20~7/22 · 1/10부터 3/31까지 매주 수요일 오후8시 · 10/10부터 계속
          수요일8시
        </small>
        {text.trim() && (
          <>
            {parsed.errors.length > 0 && (
              <p className="alert error">{parsed.errors.join(" ")}</p>
            )}
            {parsed.undated && (
              <p className="alert">
                날짜 미정은 연간계획의 초안에서 보관해 주세요. 날짜가 정해지기
                전에는 등록하지 않아요.
              </p>
            )}
            {parsed.kind === "dated" && (
              <p className="alert">
                {parsed.startDate}
                {parsed.endDate !== parsed.startDate
                  ? ` ~ ${parsed.endDate}`
                  : ""}
                {parsed.recurrence
                  ? parsed.recurrence.until === null
                    ? " · 종료일 없이 계속 반복"
                    : ` · ${parsed.recurrence.until}까지 반복`
                  : ""}
                {parsed.hasTime
                  ? parsed.allDay
                    ? " · 종일"
                    : ` · ${selectedTime || parsed.startTime} 시작`
                  : ""}
              </p>
            )}
            {parsed.timeAmbiguous && (
              <label className="field">
                <span>오전·오후를 선택해 주세요</span>
                <select
                  value={selectedTime}
                  onChange={(e) => setSelectedTime(e.target.value)}
                >
                  <option value="">시간 확인이 필요해요</option>
                  {choices.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {parsed.warnings.map((warning) => (
              <small className="muted" key={warning}>
                {warning}
              </small>
            ))}
            <button
              type="button"
              className="button"
              disabled={!canApply}
              onClick={apply}
            >
              날짜 표현 적용
            </button>
          </>
        )}
        {message && (
          <p role="status" className="muted">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
