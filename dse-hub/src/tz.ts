export interface TzOption { id: string; label: string }
export const TZ_OPTIONS: TzOption[] = [
  { id: "America/New_York", label: "Eastern (ET)" },
  { id: "America/Chicago", label: "Central (CT)" },
  { id: "America/Denver", label: "Mountain (MT)" },
  { id: "America/Los_Angeles", label: "Pacific (PT)" },
  { id: "America/Anchorage", label: "Alaska (AKT)" },
  { id: "Pacific/Honolulu", label: "Hawaii (HT)" },
  { id: "UTC", label: "UTC" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Berlin", label: "Central Europe" },
  { id: "Asia/Kolkata", label: "India (IST)" },
];

// Offset (minutes) of an IANA zone at a UTC instant.
function tzOffsetMinutes(tz: string, ts: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p: Record<string,string> = {};
  for (const part of dtf.formatToParts(new Date(ts))) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUTC - ts) / 60000;
}
// Wall time (dateISO + h:m) in `tz` -> the corresponding UTC Date (two-pass for DST edges).
function wallToUtc(dateISO: string, h: number, m: number, tz: string): Date {
  const [y, mo, d] = dateISO.split("-").map(Number);
  let ts = Date.UTC(y, mo - 1, d, h, m);
  const o1 = tzOffsetMinutes(tz, ts); ts -= o1 * 60000;
  const o2 = tzOffsetMinutes(tz, ts); if (o2 !== o1) ts += (o1 - o2) * 60000;
  return new Date(ts);
}
// "HH:MM" in sourceTz on dateISO -> "HH:MM" (24h) in targetTz.
export function convertHHMM(dateISO: string, hhmm: string, sourceTz: string, targetTz: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const utc = wallToUtc(dateISO, h, m, sourceTz);
  const p: Record<string,string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", { timeZone: targetTz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(utc)) p[part.type] = part.value;
  return `${p.hour}:${p.minute}`;
}
// Short zone label (e.g. "CST"/"PDT") for a date.
export function tzAbbrev(tz: string, dateISO: string): string {
  const utc = wallToUtc(dateISO, 12, 0, tz);
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short", hour: "numeric" })
    .formatToParts(utc).find((x) => x.type === "timeZoneName");
  return part?.value ?? tz;
}

import { formatTimeRange } from "./calendar";
export function formatRangeInTz(start: string | undefined, end: string | undefined,
    sourceTz: string, targetTz: string, dateISO: string): string {
  if (!start) return "";
  const s = convertHHMM(dateISO, start, sourceTz, targetTz);
  const e = end ? convertHHMM(dateISO, end, sourceTz, targetTz) : undefined;
  return `${formatTimeRange(s, e)} ${tzAbbrev(targetTz, dateISO)}`;
}
