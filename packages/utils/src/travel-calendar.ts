// Policy evidence: 国办发明电〔2025〕7号 (2025-11-04), checked 2026-10-07.
// Official reproduction: https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html
// These dates only trigger UNKNOWN. They do not prove any venue's hours.
export const CALENDAR_YEARS = [2026];
const ranges: [[string, number]] | [string, number][] = [
  ["2026-01-01", 3],
  ["2026-02-15", 9],
  ["2026-04-04", 3],
  ["2026-05-01", 5],
  ["2026-06-19", 3],
  ["2026-09-25", 3],
  ["2026-10-01", 7],
];
export const SPECIAL_DATES = [
  ...ranges.flatMap(([start, count]) =>
    Array.from({ length: count }, (_, i) => {
      const day = new Date(start + "T00:00:00Z");
      day.setUTCDate(day.getUTCDate() + i);
      return day.toISOString().slice(0, 10);
    }),
  ),
  "2026-01-04",
  "2026-02-14",
  "2026-02-28",
  "2026-05-09",
  "2026-09-20",
  "2026-10-10",
];
