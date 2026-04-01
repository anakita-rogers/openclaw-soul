import { randomBytes } from "node:crypto";
import { createSoulLogger } from "./logger.js";
import { updateEgoStore, resolveEgoStorePath } from "./ego-store.js";
import type { EgoState, SoulMemory, MemoryType, MemoryTier } from "./types.js";

const log = createSoulLogger("consolidation");

const MAX_LONG_TERM = 40;
const MAX_SHORT_TERM = 60;
const CONSOLIDATION_AGE_HOURS = 24;
const FADE_THRESHOLD = 0.3;
const PROMOTE_IMPORTANCE = 0.8;
const PROMOTE_ACCESS_COUNT = 3;
const MIN_CLUSTER_SIZE = 3;
const MIN_SHARED_TAGS = 2;

export interface ConsolidationResult {
  merged: number;
  promoted: number;
  faded: number;
  totalAfter: number;
}

export async function consolidateMemories(ego: EgoState): Promise<ConsolidationResult> {
  const now = Date.now();
  const storePath = resolveEgoStorePath();
  const result: ConsolidationResult = { merged: 0, promoted: 0, faded: 0, totalAfter: 0 };

  await updateEgoStore(storePath, (e) => {
    const memories = e.memories;

    // 1. Fade short-term memories with low decayFactor
    const toFade = memories.filter((m) => {
      const tier = m.tier ?? "short-term";
      if (tier !== "short-term") return false;
      const age = (now - m.timestamp) / (1000 * 60 * 60);
      return age > CONSOLIDATION_AGE_HOURS && (m.decayFactor ?? 1) < FADE_THRESHOLD;
    });

    const fadeIds = new Set(toFade.map((m) => m.id));
    let remaining = memories.filter((m) => !fadeIds.has(m.id));
    result.faded = toFade.length;

    // 2. Cluster short-term memories by shared tags
    const candidates = remaining.filter((m) => {
      const tier = m.tier ?? "short-term";
      if (tier !== "short-term") return false;
      const age = (now - m.timestamp) / (1000 * 60 * 60);
      return age > CONSOLIDATION_AGE_HOURS;
    });

    const clusters = clusterMemories(candidates);
    const mergedIds = new Set<string>();

    for (const cluster of clusters) {
      if (cluster.length < MIN_CLUSTER_SIZE) continue;

      const consolidated = mergeCluster(cluster, now);
      remaining.push(consolidated);

      for (const m of cluster) {
        mergedIds.add(m.id);
      }
      result.merged++;
    }

    remaining = remaining.filter((m) => !mergedIds.has(m.id));

    // 3. Promote high-value short-term memories to long-term
    for (const m of remaining) {
      const tier = m.tier ?? "short-term";
      if (tier !== "short-term") continue;

      if (m.importance >= PROMOTE_IMPORTANCE || (m.accessCount ?? 0) >= PROMOTE_ACCESS_COUNT) {
        m.tier = "long-term";
        result.promoted++;
      }
    }

    // 4. Enforce budget
    const longTerm = remaining.filter((m) => (m.tier ?? "short-term") === "long-term");
    const shortTerm = remaining.filter((m) => (m.tier ?? "short-term") === "short-term");

    if (longTerm.length > MAX_LONG_TERM) {
      longTerm.sort((a, b) => a.importance - b.importance);
      const toRemove = longTerm.splice(0, longTerm.length - MAX_LONG_TERM);
      const removeSet = new Set(toRemove.map((m) => m.id));
      remaining = remaining.filter((m) => !removeSet.has(m.id));
    }

    if (shortTerm.length > MAX_SHORT_TERM) {
      shortTerm.sort((a, b) => {
        const decayA = a.decayFactor ?? 1;
        const decayB = b.decayFactor ?? 1;
        return decayA - decayB;
      });
      const toRemove = shortTerm.splice(0, shortTerm.length - MAX_SHORT_TERM);
      const removeSet = new Set(toRemove.map((m) => m.id));
      remaining = remaining.filter((m) => !removeSet.has(m.id));
    }

    // Clean up dangling associations
    const validIds = new Set(remaining.map((m) => m.id));
    for (const m of remaining) {
      if (m.associations) {
        m.associations = m.associations.filter((a) => validIds.has(a.targetId));
      }
    }

    e.memories = remaining;
    result.totalAfter = remaining.length;
    return e;
  });

  if (result.merged > 0 || result.faded > 0 || result.promoted > 0) {
    log.info(
      `Consolidation: merged=${result.merged} promoted=${result.promoted} faded=${result.faded} total=${result.totalAfter}`,
    );
  }

  return result;
}

function clusterMemories(memories: SoulMemory[]): SoulMemory[][] {
  const clusters: SoulMemory[][] = [];
  const assigned = new Set<string>();

  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    if (assigned.has(m.id)) continue;

    const cluster: SoulMemory[] = [m];
    assigned.add(m.id);

    for (let j = i + 1; j < memories.length; j++) {
      const n = memories[j];
      if (assigned.has(n.id)) continue;

      // Same type qualifies
      if (m.type === n.type) {
        cluster.push(n);
        assigned.add(n.id);
        continue;
      }

      // Shared tags qualify
      const sharedTags = m.tags.filter((t) => n.tags.includes(t));
      if (sharedTags.length >= MIN_SHARED_TAGS) {
        cluster.push(n);
        assigned.add(n.id);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function mergeCluster(cluster: SoulMemory[], now: number): SoulMemory {
  // Pick the most common type, default to "insight"
  const typeCounts = new Map<MemoryType, number>();
  for (const m of cluster) {
    typeCounts.set(m.type, (typeCounts.get(m.type) ?? 0) + 1);
  }
  const dominantType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "insight";

  // Weighted average emotion
  const totalImportance = cluster.reduce((s, m) => s + m.importance, 0);
  const avgEmotion =
    totalImportance > 0
      ? cluster.reduce((s, m) => s + m.emotion * m.importance, 0) / totalImportance
      : 0;

  // Max importance boosted by consolidation
  const maxImportance = Math.min(1, Math.max(...cluster.map((m) => m.importance)) * 1.2);

  // Union of tags
  const allTags = [...new Set(cluster.flatMap((m) => m.tags))];

  // Template summary
  const snippets = cluster
    .map((m) => m.content.slice(0, 30))
    .filter(Boolean)
    .join("; ");
  const content = `Synthesized ${cluster.length} experiences: ${snippets}`;

  const valence = avgEmotion > 10 ? "positive" : avgEmotion < -10 ? "negative" : "neutral";

  // Merge associations
  const mergedAssocs = new Map<string, { strength: number; reason: string }>();
  for (const m of cluster) {
    for (const a of m.associations ?? []) {
      const existing = mergedAssocs.get(a.targetId);
      if (!existing || a.strength > existing.strength) {
        mergedAssocs.set(a.targetId, { strength: a.strength, reason: a.reason });
      }
    }
  }

  return {
    id: randomBytes(8).toString("hex"),
    type: dominantType,
    content,
    emotion: avgEmotion,
    valence,
    importance: maxImportance,
    timestamp: now,
    tags: allTags,
    tier: "long-term" as MemoryTier,
    consolidatedFrom: cluster.map((m) => m.id),
    consolidationTimestamp: now,
    associations: [...mergedAssocs.entries()]
      .slice(0, 10)
      .map(([targetId, { strength, reason }]) => ({
        targetId,
        strength,
        reason,
        createdAt: now,
      })),
    accessCount: 0,
    decayFactor: 1.0,
  };
}

export function decayShortTermMemories(ego: EgoState, elapsedHours: number): void {
  const decayRate = 1 - 0.001 * elapsedHours;
  for (const m of ego.memories) {
    const tier = m.tier ?? "short-term";
    if (tier === "short-term" && m.decayFactor !== undefined) {
      m.decayFactor = Math.max(0, m.decayFactor * decayRate);
    }
  }
}
