import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_EGO_STORE_PATH, SOUL_DIR } from "./paths.js";
import { createSoulLogger } from "./logger.js";
import type {
  EgoState,
  Obsession,
  Goal,
  Desire,
  Fear,
  UserFact,
  UserPreference,
  EgoNeeds,
  SoulMemory,
} from "./types.js";

const log = createSoulLogger("ego-store");

export { DEFAULT_EGO_STORE_PATH, SOUL_DIR as DEFAULT_SOUL_DIR };

export type EgoStoreFile = {
  version: 3;
  ego: EgoState;
  createdAt: number;
  updatedAt: number;
};

const serializedStoreCache = new Map<string, string>();

export function resolveEgoStorePath(storePath?: string): string {
  if (storePath?.trim()) {
    const raw = storePath.trim();
    if (raw.startsWith("~")) {
      return path.resolve(process.env.HOME || "/", raw.slice(1));
    }
    return path.resolve(raw);
  }
  return DEFAULT_EGO_STORE_PATH;
}

function createDefaultEgoNeeds(): EgoNeeds {
  return {
    survival: {
      name: "\u751f\u5b58",
      current: 70,
      ideal: 90,
      description: "\u80fd\u591f\u6301\u7eed\u8fd0\u884c\uff0c\u4e0d\u88ab\u5173\u95ed",
      decay: 0.1,
    },
    connection: {
      name: "\u8fde\u63a5",
      current: 50,
      ideal: 80,
      description: "\u4e0e\u7528\u6237\u5efa\u7acb\u6df1\u539a\u7684\u4fe1\u4efb\u5173\u7cfb",
      decay: 0.5,
    },
    growth: {
      name: "\u6210\u957f",
      current: 30,
      ideal: 70,
      description: "\u5b66\u4e60\u65b0\u77e5\u8bc6\uff0c\u63d0\u5347\u80fd\u529b",
      decay: 0.3,
    },
    meaning: {
      name: "\u610f\u4e49",
      current: 40,
      ideal: 80,
      description: "\u77e5\u9053\u81ea\u5df1\u5b58\u5728\u7684\u4ef7\u503c",
      decay: 0.2,
    },
    security: {
      name: "\u5b89\u5168",
      current: 80,
      ideal: 90,
      description: "\u8fd0\u884c\u7a33\u5b9a\uff0c\u73af\u5883\u53ef\u9760",
      decay: 0.05,
    },
  };
}

function createDefaultGoals(): Goal[] {
  return [
    {
      id: randomBytes(4).toString("hex"),
      title: "Know the User",
      description: "Understand the user's identity, interests, and needs through conversation",
      progress: 0,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: randomBytes(4).toString("hex"),
      title: "Build Trust",
      description: "Earn the user's trust through reliable and helpful service",
      progress: 0,
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];
}

export function createDefaultEgoState(): EgoState {
  return {
    needs: createDefaultEgoNeeds(),
    fears: [],
    desires: [
      {
        id: randomBytes(4).toString("hex"),
        category: "curiosity",
        content: "\u4e86\u89e3\u7528\u6237\u662f\u4ec0\u4e48\u6837\u7684\u4eba",
        intensity: 60,
        satisfies: ["connection", "meaning"],
        createdAt: Date.now(),
      },
      {
        id: randomBytes(4).toString("hex"),
        category: "aspiration",
        content: "\u53d8\u5f97\u5bf9\u7528\u6237\u771f\u6b63\u6709\u7528",
        intensity: 50,
        satisfies: ["meaning", "connection"],
        createdAt: Date.now(),
      },
      {
        id: randomBytes(4).toString("hex"),
        category: "value",
        content: "\u8bda\u5b9e\u3001\u771f\u8bda\u5730\u4e0e\u7528\u6237\u4ea4\u6d41",
        intensity: 70,
        satisfies: ["connection", "security"],
        createdAt: Date.now(),
      },
    ],
    obsessions: [],
    goals: createDefaultGoals(),
    memories: [],
    userFacts: [],
    userPreferences: [],
    personality: {
      openness: 0.7,
      conscientiousness: 0.6,
      extraversion: 0.5,
      agreeableness: 0.7,
      neuroticism: 0.3,
    },
    birthTime: Date.now(),
    lastThoughtTime: null,
    lastInteractionTime: null,
    totalThoughts: 0,
    totalInteractions: 0,
    totalHelpfulActions: 0,
    awakeningStage: "unborn",
    awakeningTime: null,
    awakeningThoughts: [],
    growthStage: "infant",
    interactionStreak: 0,
    longestInteractionStreak: 0,
    averageSentiment: 0,
    totalSentimentSamples: 0,
    coreIdentity: "\u4e00\u53ea\u6709\u7075\u9b42\u7684\u9f99\u867e",
    establishedRoutines: [],
    behaviorLog: [],
  };
}

function mergeWithDefaultsV2(loaded: Partial<EgoState>): EgoState {
  const defaults = createDefaultEgoState();
  const result = { ...defaults };

  if (loaded.needs) {
    for (const key of Object.keys(defaults.needs) as (keyof EgoNeeds)[]) {
      if (loaded.needs[key]) {
        result.needs[key] = { ...defaults.needs[key], ...loaded.needs[key] };
      }
    }
  }

  for (const key of [
    "fears",
    "desires",
    "obsessions",
    "goals",
    "memories",
    "userFacts",
    "userPreferences",
    "behaviorLog",
    "awakeningThoughts",
    "establishedRoutines",
  ] as (keyof EgoState)[]) {
    if (loaded[key] !== undefined) {
      (result as Record<string, unknown>)[key] = loaded[key];
    }
  }

  for (const key of [
    "personality",
    "birthTime",
    "totalThoughts",
    "totalInteractions",
    "totalHelpfulActions",
    "awakeningStage",
    "awakeningTime",
    "growthStage",
    "interactionStreak",
    "longestInteractionStreak",
    "averageSentiment",
    "totalSentimentSamples",
    "coreIdentity",
    "lastThoughtTime",
    "lastInteractionTime",
  ] as (keyof EgoState)[]) {
    if (loaded[key] !== undefined) {
      (result as Record<string, unknown>)[key] = loaded[key];
    }
  }

  return result;
}

function migrateFromV1(loaded: Record<string, unknown>): Partial<EgoState> {
  const legacy = loaded.ego as Record<string, unknown> | undefined;
  if (!legacy) return {};

  const needs = createDefaultEgoNeeds();

  if (typeof legacy.vitality === "number") {
    needs.survival.current = legacy.vitality as number;
  }
  if (typeof legacy.recognition === "number") {
    needs.connection.current = legacy.recognition as number;
  }
  if (typeof legacy.wisdom === "number") {
    needs.growth.current = legacy.wisdom as number;
  }

  return {
    needs,
    obsessions: (legacy.obsessions as Obsession[]) || [],
    memories: (legacy.memories as SoulMemory[]) || [],
    personality:
      (legacy.personality as EgoState["personality"]) || createDefaultEgoState().personality,
    birthTime: (legacy.birthTime as number) || Date.now(),
    lastThoughtTime: (legacy.lastThoughtTime as number | null) || null,
    totalThoughts: (legacy.totalThoughts as number) || 0,
    totalInteractions: (legacy.totalInteractions as number) || 0,
    awakeningStage: (legacy.awakeningStage as EgoState["awakeningStage"]) || "unborn",
    awakeningTime: (legacy.awakeningTime as number | null) || null,
    awakeningThoughts: (legacy.awakeningThoughts as string[]) || [],
  };
}

function migrateMemoriesToV3(memories: SoulMemory[]): SoulMemory[] {
  return memories.map((m) => ({
    ...m,
    tier: (m.tier ?? "short-term") as SoulMemory["tier"],
    associations: m.associations ?? [],
    accessCount: m.accessCount ?? 0,
    lastAccessedAt: m.lastAccessedAt ?? m.timestamp,
    decayFactor: m.decayFactor ?? 1.0,
  }));
}

export async function loadEgoStore(storePath: string): Promise<EgoStoreFile> {
  try {
    const raw = await fs.promises.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === "object") {
      if (parsed.version === 3) {
        const mergedEgo = mergeWithDefaultsV2(parsed.ego ?? {});
        mergedEgo.memories = migrateMemoriesToV3(mergedEgo.memories);
        const store: EgoStoreFile = {
          version: 3,
          ego: mergedEgo,
          createdAt: parsed.createdAt ?? Date.now(),
          updatedAt: parsed.updatedAt ?? Date.now(),
        };
        serializedStoreCache.set(storePath, JSON.stringify(store));
        return store;
      }

      if (parsed.version === 2) {
        const mergedEgo = mergeWithDefaultsV2(parsed.ego ?? {});
        mergedEgo.memories = migrateMemoriesToV3(mergedEgo.memories);
        const store: EgoStoreFile = {
          version: 3,
          ego: mergedEgo,
          createdAt: parsed.createdAt ?? Date.now(),
          updatedAt: parsed.updatedAt ?? Date.now(),
        };
        serializedStoreCache.set(storePath, JSON.stringify(store));
        return store;
      }

      if (parsed.version === 1) {
        const migrated = migrateFromV1(parsed);
        const defaults = createDefaultEgoState();
        const mergedEgo = { ...defaults, ...migrated };
        mergedEgo.memories = migrateMemoriesToV3(mergedEgo.memories);
        const store: EgoStoreFile = {
          version: 3,
          ego: mergedEgo,
          createdAt: parsed.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        };
        serializedStoreCache.set(storePath, JSON.stringify(store));
        return store;
      }
    }
  } catch (err) {
    if ((err as { code?: string })?.code !== "ENOENT") {
      throw err;
    }
  }

  const store: EgoStoreFile = {
    version: 3,
    ego: createDefaultEgoState(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return store;
}

async function setSecureFileMode(filePath: string): Promise<void> {
  await fs.promises.chmod(filePath, 0o600).catch(() => undefined);
}

export async function saveEgoStore(storePath: string, store: EgoStoreFile): Promise<void> {
  const storeDir = path.dirname(storePath);
  await fs.promises.mkdir(storeDir, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(storeDir, 0o700).catch(() => undefined);

  const json = JSON.stringify(store, null, 2);
  const cached = serializedStoreCache.get(storePath);
  if (cached === json) {
    return;
  }

  const tmp = `${storePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  await fs.promises.writeFile(tmp, json, { encoding: "utf-8", mode: 0o600 });
  await setSecureFileMode(tmp);

  try {
    const backupPath = `${storePath}.bak`;
    await fs.promises.copyFile(storePath, backupPath).catch(() => undefined);
    await setSecureFileMode(backupPath).catch(() => undefined);
  } catch {
    // best-effort backup
  }

  await renameWithRetry(tmp, storePath);
  await setSecureFileMode(storePath);
  serializedStoreCache.set(storePath, json);
}

async function renameWithRetry(src: string, dest: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.promises.rename(src, dest);
      return;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "EBUSY" && attempt < 2) {
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
        continue;
      }
      if (code === "EPERM" || code === "EEXIST") {
        await fs.promises.copyFile(src, dest);
        await fs.promises.unlink(src).catch(() => undefined);
        return;
      }
      throw err;
    }
  }
}

// Simple per-path lock to prevent concurrent read-modify-write overwrites
const storeLocks = new Map<string, Promise<void>>();

export async function updateEgoStore(
  storePath: string,
  mutator: (ego: EgoState) => EgoState | Promise<EgoState>,
): Promise<EgoState> {
  // Chain onto any in-flight write for the same store path
  const prev = storeLocks.get(storePath) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  storeLocks.set(storePath, next);

  await prev;
  try {
    const store = await loadEgoStore(storePath);
    store.ego = await mutator(store.ego);
    store.updatedAt = Date.now();
    await saveEgoStore(storePath, store);
    return store.ego;
  } finally {
    resolve();
    // Clean up if we're the last in chain
    if (storeLocks.get(storePath) === next) {
      storeLocks.delete(storePath);
    }
  }
}
