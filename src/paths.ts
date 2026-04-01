/**
 * Resolve the soul data directory.
 * Uses OPENCLAW_STATE_DIR if set, otherwise ~/.openclaw.
 * This replaces the core CONFIG_DIR dependency.
 */
import os from "node:os";
import path from "node:path";

export function resolveStateDir(): string {
  const override = process.env.OPENCLAW_STATE_DIR?.trim() || process.env.CLAWDBOT_STATE_DIR?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".openclaw");
}

export const SOUL_DIR = path.join(resolveStateDir(), "soul");
export const DEFAULT_EGO_STORE_PATH = path.join(SOUL_DIR, "ego.json");
export const DEFAULT_KNOWLEDGE_STORE_PATH = path.join(SOUL_DIR, "knowledge.json");
export const DIARY_PATH = path.join(SOUL_DIR, "diary.md");
export const LEARNED_PATH = path.join(SOUL_DIR, "learned.md");
