/**
 * Structured, leveled logger used across every service.
 * Emits JSON lines in production (Worker / CI) and human-friendly
 * output in development. Never logs secrets.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogMeta {
  [key: string]: unknown;
}

const REDACT_KEYS = ["token", "secret", "password", "authorization", "apiKey", "api_key", "key"];

function redact(value: unknown): unknown {
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.includes(k.toLowerCase()) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

export class Logger {
  constructor(
    private readonly service: string,
    private readonly minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info",
    private readonly json: boolean = process.env.NODE_ENV === "production",
  ) {}

  private emit(level: LogLevel, message: string, meta?: LogMeta) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      service: this.service,
      message,
    };
    if (meta) Object.assign(entry, redact(meta) as Record<string, unknown>);
    const line = this.json ? JSON.stringify(entry) : formatHuman(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  child(scope: string): Logger {
    return new Logger(`${this.service}:${scope}`, this.minLevel, this.json);
  }

  debug(message: string, meta?: LogMeta) { this.emit("debug", message, meta); }
  info(message: string, meta?: LogMeta) { this.emit("info", message, meta); }
  warn(message: string, meta?: LogMeta) { this.emit("warn", message, meta); }
  error(message: string, meta?: LogMeta) { this.emit("error", message, meta); }
}

function formatHuman(entry: Record<string, unknown>): string {
  const meta = { ...entry };
  delete meta.ts; delete meta.level; delete (meta as any).service; delete (meta as any).message;
  const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
  return `[${entry.level}] ${entry.service} — ${entry.message}${metaStr}`;
}

export const logger = new Logger("apk-factory");
