import { extractBigrams } from "./memory-association.js";
import type {
  SoulMemory,
  EmotionValence,
  EmotionalEcho,
  RecallResult,
  MetricDelta,
  EgoNeeds,
  MemoryType,
} from "./types.js";

export interface ScoredMemory {
  memory: SoulMemory;
  score: number;
  recalledVia: "direct" | `association:${string}`;
}

// How much each memory type is worth in recall for user-facing context
const TYPE_RELEVANCE: Record<MemoryType, number> = {
  "user-fact": 0.9,
  "user-preference": 0.9,
  interaction: 0.7,
  achievement: 0.6,
  failure: 0.6,
  insight: 0.7,
  learning: 0.5,
  desire: 0.3,
  fear: 0.3,
  thought: 0.2,
};

export function scoreMemoryRelevance(
  memory: SoulMemory,
  context: string,
  currentTime: number,
  currentEmotion: number,
): number {
  let score = 0;

  // Content match: bigram overlap (0-3)
  const contextBigrams = extractBigrams(context);
  const memoryBigrams = extractBigrams(memory.content);
  if (contextBigrams.length > 0 && memoryBigrams.length > 0) {
    const shared = contextBigrams.filter((b) => memoryBigrams.includes(b));
    const overlap = shared.length / Math.max(contextBigrams.length, memoryBigrams.length);
    score += Math.min(3, overlap * 6);
  }

  // Tag match: +1 per exact tag match (0-4)
  const contextLower = context.toLowerCase();
  let tagScore = 0;
  for (const tag of memory.tags) {
    if (contextLower.includes(tag.toLowerCase())) {
      tagScore += 1;
    }
  }
  score += Math.min(4, tagScore);

  // Type relevance (0-1)
  score += TYPE_RELEVANCE[memory.type] ?? 0.2;

  // Temporal boost: exponential decay over a week (0-2)
  const hoursAgo = (currentTime - memory.timestamp) / (1000 * 60 * 60);
  if (hoursAgo >= 0) {
    score += 2 * Math.exp(-hoursAgo / 168);
  }

  // Importance weight (0-1)
  score += memory.importance;

  // Emotion relevance (0-1)
  if (memory.valence !== "neutral") {
    const memoryEmotionNorm = memory.emotion > 0 ? 1 : memory.emotion < 0 ? -1 : 0;
    const currentEmotionNorm = currentEmotion > 0 ? 1 : currentEmotion < 0 ? -1 : 0;
    if (memoryEmotionNorm === currentEmotionNorm) {
      score += 0.5;
    }
    if (Math.abs(memory.emotion) > 50) {
      score += 0.5;
    }
  }

  return score;
}

export function recallMemories(
  context: string,
  allMemories: SoulMemory[],
  currentTime: number,
  currentEmotion: number,
  maxResults = 5,
  maxCandidates = 10,
): RecallResult {
  if (allMemories.length === 0 || !context || context.length < 2) {
    return {
      memories: [],
      emotionalEcho: { averageEmotion: 0, dominantValence: "neutral", intensity: 0 },
    };
  }

  // Phase 1: Direct scoring
  const scored: ScoredMemory[] = allMemories.map((m) => ({
    memory: m,
    score: scoreMemoryRelevance(m, context, currentTime, currentEmotion),
    recalledVia: "direct" as const,
  }));

  scored.sort((a, b) => b.score - a.score);

  // Phase 2: Association spread (depth 1)
  const topCandidates = scored.slice(0, maxCandidates);
  const seen = new Map<string, ScoredMemory>();
  for (const s of scored) {
    seen.set(s.memory.id, s);
  }

  for (const candidate of topCandidates) {
    if (candidate.score < 2) continue;
    const associations = candidate.memory.associations ?? [];
    for (const assoc of associations) {
      const existing = seen.get(assoc.targetId);
      const spreadScore = candidate.score * assoc.strength * 0.5;
      if (existing) {
        // Keep the higher score
        if (spreadScore > existing.score) {
          existing.score = spreadScore;
          existing.recalledVia = `association:${candidate.memory.id}`;
        }
      } else {
        const targetMemory = allMemories.find((m) => m.id === assoc.targetId);
        if (targetMemory) {
          seen.set(assoc.targetId, {
            memory: targetMemory,
            score: spreadScore,
            recalledVia: `association:${candidate.memory.id}`,
          });
        }
      }
    }
  }

  // Phase 3: Dedup, sort, return top N
  const finalScored = Array.from(seen.values()).sort((a, b) => b.score - a.score);
  const results = finalScored.slice(0, maxResults);

  // Update access stats on recalled memories
  for (const r of results) {
    r.memory.accessCount = (r.memory.accessCount ?? 0) + 1;
    r.memory.lastAccessedAt = currentTime;
    r.memory.decayFactor = Math.min(1, (r.memory.decayFactor ?? 1) + 0.2);
  }

  const recalledMemories = results.map((r) => r.memory);
  const emotionalEcho = computeEmotionalEcho(recalledMemories);

  return { memories: recalledMemories, emotionalEcho };
}

export function computeEmotionalEcho(memories: SoulMemory[]): EmotionalEcho {
  if (memories.length === 0) {
    return { averageEmotion: 0, dominantValence: "neutral", intensity: 0 };
  }

  let totalEmotion = 0;
  let posCount = 0;
  let negCount = 0;

  for (const m of memories) {
    totalEmotion += m.emotion;
    if (m.valence === "positive") posCount++;
    else if (m.valence === "negative") negCount++;
  }

  const averageEmotion = totalEmotion / memories.length;
  const dominantValence: EmotionValence =
    posCount > negCount ? "positive" : negCount > posCount ? "negative" : "neutral";
  const intensity = Math.min(1, Math.abs(averageEmotion) / 50 + memories.length * 0.1);

  return { averageEmotion, dominantValence, intensity };
}

export function computeEmotionalNudge(echo: EmotionalEcho): MetricDelta[] {
  const deltas: MetricDelta[] = [];
  const magnitude = echo.intensity;

  if (magnitude < 0.1) return deltas;

  if (echo.dominantValence === "positive") {
    deltas.push({ need: "connection", delta: magnitude * 2, reason: "Warm memories bring connection" });
    deltas.push({ need: "meaning", delta: magnitude * 1.5, reason: "Beautiful memories bring meaning" });
  } else if (echo.dominantValence === "negative") {
    deltas.push({ need: "security", delta: -magnitude, reason: "Heavy memories affect security" });
    deltas.push({
      need: "connection",
      delta: magnitude * 0.5,
      reason: "Difficult memories deepen desire for connection",
    });
  }

  return deltas;
}

export function computeCurrentEmotion(needs: EgoNeeds): number {
  let total = 0;
  let count = 0;
  for (const [, need] of Object.entries(needs)) {
    const satisfaction = (need.current / need.ideal) * 100;
    total += satisfaction - 50; // center around 0: >50 = positive, <50 = negative
    count++;
  }
  return count > 0 ? total / count : 0;
}
