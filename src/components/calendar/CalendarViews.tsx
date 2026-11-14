import type { ChurchDay, Occurrence } from "@/domain/types";
import { organization } from "@/domain/organizations";
import { occurrencesOnDate, timeLabel, dateLabel } from "@/domain/calendar";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const iso = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
export function monthDates(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((first + length) / 7) * 7 }, (_, i) =>
    iso(year, month, i - first + 1),
  );
}
export function EventTag({
  event,
  onClick,
}: {
  event: Occurrence;
  onClick: () => void;
}) {
  const org = organization(event.organizationId);
  return (
    <button
      className={`event-tag ${event.status === "cancelled" ? "cancelled" : ""}`}
      style={{
        color: org.color,
        background: org.light,
        borderLeftColor: org.color,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`${event.title} · ${org.name} · ${timeLabel(event)}`}
    >
      <span>
        {!event.allDay && event.startTime}{" "}
        {event.status === "tentative" && "예정 · "}
        {event.title}
      </span>
      <small>{org.name}</small>
    </button>
  );
}
export function MonthView({
  year,
  month,
  events,
  days,
  today,
  onDate,
  onDetail,
}: {
  year: number;
  month: number;
  events: Occurrence[];
  days: ChurchDay[];
  today: string;
  onDate: (date: string) => void;
  onDetail: (event: Occurrence) => void;
}) {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  return (
    <div className="month-calendar">
      <div className="weekdays">
        {weekdays.map((w, i) => (
          <span
            key={w}
            className={i === 0 ? "sunday" : i === 6 ? "saturday" : ""}
          >
            {w}
          </span>
        ))}
      </div>
      <div className="month-grid">
        {monthDates(year, month).map((date, i) => {
          const inside = date.startsWith(prefix);
          const items = inside ? occurrencesOnDate(events, date) : [];
          const marks = inside ? days.filter((d) => d.date === date) : [];
          return (
            <div
              key={date}
              className={`day-cell ${inside ? "" : "outside"} ${date === today ? "today-cell" : ""}`}
              role="group"
              aria-label={
                inside
                  ? `${dateLabel(date)}, 일정 ${items.length}개`
                  : undefined
              }
              tabIndex={inside ? 0 : undefined}
              onClick={() => {
                if (inside) onDate(date);
              }}
              onKeyDown={(e) => {
                if (
                  inside &&
                  e.target === e.currentTarget &&
                  (e.key === "Enter" || e.key === " ")
                ) {
                  e.preventDefault();
                  onDate(date);
                }
              }}
            >
              <div className="day-heading">
                <button
                  disabled={!inside}
                  className={`date-button ${date === today ? "today-number" : ""} ${i % 7 === 0 ? "sunday" : i % 7 === 6 ? "saturday" : ""}`}
                  aria-label={`${dateLabel(date)}, 일정 ${items.length}개`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDate(date);
                  }}
                >
                  {Number(date.slice(8))}
                </button>
                {date === today && <small>오늘</small>}
              </div>
              {marks.map((mark, index) => (
                <span
                  className="church-marker"
                  key={`${mark.name}-${index}`}
                  title={mark.note}
                >
                  {mark.name}
                </span>
              ))}
              <div className="day-events">
                {items.slice(0, 3).map((item) => (
                  <EventTag
                    key={item.key}
                    event={item}
                    onClick={() => onDetail(item)}
                  />
                ))}
                {items.length > 3 && (
                  <button
                    className="more-events"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDate(date);
                    }}
                  >
                    + {items.length - 3}개 더 보기
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
export function YearView({
  year,
  events,
  days,
  today,
  onMonth,
  onDate,
}: {
  year: number;
  events: Occurrence[];
  days: ChurchDay[];
  today: string;
  onMonth: (month: number) => void;
  onDate: (date: string) => void;
}) {
  return (
    <div className="year-grid">
      {Array.from({ length: 12 }, (_, month) => {
        const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
        const count = events.filter(
          (e) => e.startDate <= `${prefix}-31` && e.endDate >= `${prefix}-01`,
        ).length;
        return (
          <section
            className="month-card"
            key={month}
            role="group"
            tabIndex={0}
            aria-label={`${year}년 ${month + 1}월 월간으로 보기`}
            onClick={() => onMonth(month)}
            onKeyDown={(e) => {
              if (
                e.target === e.currentTarget &&
                (e.key === "Enter" || e.key === " ")
              ) {
                e.preventDefault();
                onMonth(month);
              }
            }}
          >
            <button
              className="month-card-heading"
              onClick={(e) => {
                e.stopPropagation();
                onMonth(month);
              }}
            >
              <strong>{month + 1}월</strong>
              <span>
                {count ? `${count}개 일정` : "월간 보기"}
                <ArrowRight size={15} />
              </span>
            </button>
            <div className="mini-weekdays">
              {weekdays.map((w, i) => (
                <span
                  key={w}
                  className={i === 0 ? "sunday" : i === 6 ? "saturday" : ""}
                >
                  {w}
                </span>
              ))}
            </div>
            <div className="mini-dates">
              {monthDates(year, month).map((date, i) => {
                if (!date.startsWith(prefix)) return <span key={date} />;
                const items = occurrencesOnDate(events, date);
                const marks = days.filter((d) => d.date === date);
                return (
                  <button
                    key={date}
                    className={`mini-date ${date === today ? "today-number" : ""} ${items.length ? "has-event" : ""} ${i % 7 === 0 ? "sunday" : i % 7 === 6 ? "saturday" : ""}`}
                    aria-label={`${dateLabel(date)}, 일정 ${items.length}개${marks.length ? `, ${marks.map((d) => d.name).join(", ")}` : ""}`}
                    title={`${date} · ${items.length}개 일정${marks.length ? ` · ${marks.map((d) => d.name).join(", ")}` : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDate(date);
                    }}
                  >
                    {Number(date.slice(8))}
                    {items.length > 0 && (
                      <i
                        style={{
                          background: organization(items[0].organizationId)
                            .color,
                        }}
                      />
                    )}{" "}
                    {!items.length && marks.length > 0 && (
                      <i className="holiday-dot" />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="month-card-note">
              {days
                .filter((d) => d.date.startsWith(prefix))
                .slice(0, 2)
                .map((d) => (
                  <small key={`${d.date}-${d.name}`}>
                    {Number(d.date.slice(8))}일 {d.name}
                  </small>
                ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
export function AgendaView({
  events,
  focusedDate,
  onDetail,
  onClear,
  onCreate,
  canEdit,
}: {
  events: Occurrence[];
  focusedDate: string | null;
  onDetail: (e: Occurrence) => void;
  onClear: () => void;
  onCreate: () => void;
  canEdit: boolean;
}) {
  const grouped = new Map<string, Occurrence[]>();
  for (const event of events) {
    const date = focusedDate ?? event.startDate;
    grouped.set(date, [...(grouped.get(date) ?? []), event]);
  }
  return (
    <div className="agenda">
      {focusedDate && (
        <div className="day-focus">
          <strong>{dateLabel(focusedDate)} 일정</strong>
          <button className="text-button" onClick={onClear}>
            이달 전체 보기 <ArrowRight size={16} />
          </button>
        </div>
      )}
      {!events.length && (
        <div className="empty-state">
          <CalendarDays size={38} />
          <h3>선택한 범위에 일정이 없어요</h3>
          <p>부서나 검색어를 바꾸거나 새 일정을 등록해 보세요.</p>
          {canEdit && (
            <button className="button primary" onClick={onCreate}>
              일정 등록
            </button>
          )}
        </div>
      )}
      {[...grouped]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, items]) => (
          <section className="agenda-day" key={date}>
            <h3>{dateLabel(date)}</h3>
            {items.map((item) => {
              const org = organization(item.organizationId);
              return (
                <button
                  className="agenda-event"
                  key={item.key}
                  onClick={() => onDetail(item)}
                >
                  <span
                    className="agenda-line"
                    style={{ background: org.color }}
                  />
                  <span className="agenda-time">{timeLabel(item)}</span>
                  <span className="agenda-content">
                    <small style={{ color: org.color }}>
                      {org.name}
                      {item.audience === "all" ? " · 전교회 대상" : ""}
                      {item.status === "tentative" ? " · 예정" : ""}
                    </small>
                    <strong>{item.title}</strong>
                    <span>
                      {item.location && (
                        <>
                          <MapPin size={14} />
                          {item.location}
                        </>
                      )}
                      {item.endDate !== item.startDate &&
                        ` · ${item.startDate} ~ ${item.endDate}`}
                    </span>
                  </span>
                  <ArrowRight size={18} />
                </button>
              );
            })}
          </section>
        ))}
    </div>
  );
}
