import { env } from "../config/env.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /password|token|authorization|cookie|secret|hash/i;

function redact(key, value) {
  if (SENSITIVE.test(key)) return "[redacted]";
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(k, v)]));
  }
  return value;
}

function emit(level, message, context = {}) {
  if ((LEVELS[level] ?? 20) < (LEVELS[env.logLevel] ?? 20)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...Object.fromEntries(Object.entries(context ?? {}).map(([k, v]) => [k, redact(k, v)]))
  };
  const line = JSON.stringify(entry, (_key, value) => (value instanceof Error ? value.message : value));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message, context) => emit("debug", message, context),
  info: (message, context) => emit("info", message, context),
  warn: (message, context) => emit("warn", message, context),
  error: (message, context) => emit("error", message, context)
};
