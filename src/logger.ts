/**
 * Lightweight logger for the soul plugin.
 * Replaces the core createSubsystemLogger dependency.
 */
export interface SoulLogger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
}

export function createSoulLogger(prefix: string): SoulLogger {
  const fmt = (level: string, msg: string, args: unknown[]) => {
    const ts = new Date().toISOString().slice(11, 19);
    const base = `[${ts}] [${level}] [soul:${prefix}] ${msg}`;
    return args.length > 0 ? `${base} ${args.map(String).join(" ")}` : base;
  };

  return {
    info: (msg, ...args) => console.info(fmt("INFO", msg, args)),
    warn: (msg, ...args) => console.warn(fmt("WARN", msg, args)),
    error: (msg, ...args) => console.error(fmt("ERR", msg, args)),
    debug: (msg, ...args) => {
      if (process.env.SOUL_DEBUG === "1" || process.env.SOUL_LOG_LEVEL === "debug") {
        console.log(fmt("DBG", msg, args));
      }
    },
  };
}
