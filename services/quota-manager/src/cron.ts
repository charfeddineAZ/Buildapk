/**
 * Schedule helper for scheduled builds (section 30). A tiny 5-field cron
 * matcher used to decide whether a build should fire at a given time, plus a
 * bounded next-run calculator. Timezone-naive (UTC) on purpose — the Worker
 * edge runs UTC; the user's locale is applied at display time.
 */

export type CronField = number[]; // matched values (0-based)

function parseField(field: string, min: number, max: number): CronField {
  if (field === "*") return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const out = new Set<number>();
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      let [lo, hi] = range === "*" ? [min, max] : (range.includes("-") ? range.split("-").map(Number) as [number, number] : [Number(range), Number(range)]);
      for (let v = lo; v <= hi; v += step) out.add(v);
    } else if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      for (let v = lo; v <= hi; v++) out.add(v);
    } else {
      out.add(parseInt(part, 10));
    }
  }
  return [...out];
}

export interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

export function parseCron(expr: string): ParsedCron {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`invalid cron expression: ${expr}`);
  return {
    minute: parseField(f[0], 0, 59),
    hour: parseField(f[1], 0, 23),
    dayOfMonth: parseField(f[2], 1, 31),
    month: parseField(f[3], 1, 12),
    dayOfWeek: parseField(f[4], 0, 6),
  };
}

export function matchesCron(expr: string, date: Date): boolean {
  const c = parseCron(expr);
  const dow = date.getUTCDay(); // 0=Sun
  return (
    c.minute.includes(date.getUTCMinutes()) &&
    c.hour.includes(date.getUTCHours()) &&
    c.dayOfMonth.includes(date.getUTCDate()) &&
    c.month.includes(date.getUTCMonth() + 1) &&
    (c.dayOfWeek.includes(dow) || c.dayOfWeek.includes((dow + 7) % 7))
  );
}

/** Next UTC Date (within `limitMinutes`, default 2 years) matching the expr. */
export function nextRun(expr: string, from: Date, limitMinutes = 2 * 365 * 24 * 60): Date | null {
  const d = new Date(from.getTime() + 60 * 1000); // start next minute
  for (let i = 0; i < limitMinutes; i++) {
    if (matchesCron(expr, d)) return d;
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
}

export function describeSchedule(expr: string): string {
  const c = parseCron(expr);
  return `min[${c.minute.length}] hour[${c.hour.length}] dom[${c.dayOfMonth.length}] mon[${c.month.length}] dow[${c.dayOfWeek.length}]`;
}
