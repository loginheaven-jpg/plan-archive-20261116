import { addDaysISO, floatingDate } from "./calendar";
import type { ChurchDay, ChurchSettings } from "./types";

export const DEFAULT_CHURCH_SETTINGS: ChurchSettings = {
  denomination: "미확인 · 서방 그레고리력 참고",
  ashWednesday: false,
  ascension: false,
  // The editable example rule is not an assertion of this church's observance.
  thanksgiving: { enabled: false, rule: "nthSunday", month: 11, nth: 3, day: 15 },
  reformationSunday: false,
  newYear: false,
  yearEnd: false,
};

const REFERENCE_NOTE = "교회력 참고 · 실제 행사/휴무 아님";
const OPTIONAL_NOTE = `${REFERENCE_NOTE} · 선택 관행(교회설정 기준), 실제 준수 여부 별도 확인`;

function isoDate(year: number, month: number, day: number): string {
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  floatingDate(value);
  return value;
}

/** Gregorian Western Easter (Meeus/Jones/Butcher), not Orthodox or astronomical Easter. */
function easterDate(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

function nthSunday(year: number, month: number, nth: number): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(nth) || nth < 1 || nth > 5) return null;
  const first = isoDate(year, month, 1);
  const date = addDaysISO(first, (7 - floatingDate(first).getUTCDay()) % 7 + 7 * (nth - 1));
  return floatingDate(date).getUTCMonth() === month - 1 ? date : null;
}

export function churchYear(year: number, settings: ChurchSettings = DEFAULT_CHURCH_SETTINGS): ChurchDay[] {
  if (!Number.isInteger(year) || year < 1583 || year > 9998) {
    throw new RangeError("Church year must be a Gregorian year from 1583 through 9998");
  }
  const easter = easterDate(year);
  const days: ChurchDay[] = [];
  const add = (date: string, name: string, kind: ChurchDay["kind"] = "observance", note = REFERENCE_NOTE) => {
    days.push({ date, name, kind, note });
  };
  if (settings.ashWednesday) add(addDaysISO(easter, -46), "사순절 시작·재의 수요일", "season", OPTIONAL_NOTE);
  add(addDaysISO(easter, -7), "종려주일·고난주일");
  // Match the Korean Methodist calendar's Monday-through-Saturday convention.
  add(addDaysISO(easter, -6), "고난주간", "season", `${REFERENCE_NOTE} · 월요일부터 토요일(${addDaysISO(easter, -1)})까지`);
  add(addDaysISO(easter, -2), "성금요일");
  add(easter, "부활주일");
  if (settings.ascension) add(addDaysISO(easter, 39), "승천일", "observance", `${OPTIONAL_NOTE} · 목요일 기준(승천주일과 다름)`);
  add(addDaysISO(easter, 49), "성령강림주일");

  const christmas = isoDate(year, 12, 25);
  const weekday = floatingDate(christmas).getUTCDay();
  // Strictly before Christmas: when Christmas is Sunday, subtract seven, not zero.
  const lastAdvent = addDaysISO(christmas, -(weekday || 7));
  for (let index = 0; index < 4; index += 1) {
    add(addDaysISO(lastAdvent, -21 + index * 7), `대림절 ${index + 1}주일`, "season");
  }
  add(christmas, "성탄절");

  if (settings.thanksgiving.enabled) {
    const rule = settings.thanksgiving;
    let date: string | null = null;
    if (rule.rule === "nthSunday") date = nthSunday(year, rule.month, rule.nth);
    else {
      try { date = isoDate(year, rule.month, rule.day); } catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
    }
    if (date) {
      const convention = rule.rule === "nthSunday" ? `${rule.month}월 ${rule.nth}번째 주일` : "지정 고정일(주일과 다를 수 있음)";
      add(date, "추수감사주일", "observance", `${OPTIONAL_NOTE} · ${convention}`);
    }
  }
  if (settings.reformationSunday) {
    const lastOctober = isoDate(year, 10, 31);
    add(addDaysISO(lastOctober, -floatingDate(lastOctober).getUTCDay()), "종교개혁주일", "observance", `${OPTIONAL_NOTE} · 10월 마지막 주일(고정 기념일 10월 31일과 구별)`);
  }
  if (settings.newYear) {
    add(nthSunday(year, 1, 1)!, "신년주일", "observance", `${OPTIONAL_NOTE} · 1월 첫 주일(1월 1일과 구별)`);
  }
  if (settings.yearEnd) {
    add(isoDate(year, 12, 31), "송구영신", "observance", `${OPTIONAL_NOTE} · 12월 31일 참고일, 예배 시각은 별도 행사로 등록`);
  }
  return days.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "ko"));
}
