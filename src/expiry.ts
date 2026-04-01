import { createSoulLogger } from "./logger.js";
import { updateEgoStore, resolveEgoStorePath } from "./ego-store.js";
import { updateKnowledgeStore } from "./knowledge-store.js";
import type { EgoState, SoulMemory, UserFact, KnowledgeItem } from "./types.js";

const log = createSoulLogger("expiry");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface ExpiryResult {
  memoriesExpired: number;
  memoriesDemoted: number;
  factsStale: number;
  factsExpired: number;
  knowledgeExpired: number;
}

/**
 * Run all expiry/cleanup tasks. Should be called periodically (e.g. every 30 min).
 */
export async function runExpiryCycle(ego: EgoState): Promise<ExpiryResult> {
  const result: ExpiryResult = { memoriesExpired: 0, memoriesDemoted: 0, factsStale: 0, factsExpired: 0, knowledgeExpired: 0 };
  const now = Date.now();
  const storePath = resolveEgoStorePath();

  // --- 1. Expire/demote stale memories ---
  await updateEgoStore(storePath, (e) => {
    const { expired, demoted, remaining } = expireMemories(e.memories, now);
    e.memories = remaining;
    result.memoriesExpired = expired;
    result.memoriesDemoted = demoted;
    return e;
  });

  // --- 2. Mark low-confidence userFacts as stale ---
  await updateEgoStore(storePath, (e) => {
    const { stale, expired } = processStaleFacts(e.userFacts, now);
    result.factsStale = stale;
    result.factsExpired = expired;
    return e;
  });

  // --- 3. Expire stale knowledge items ---
  result.knowledgeExpired = await expireKnowledge(now);

  if (result.memoriesExpired + result.factsExpired + result.knowledgeExpired > 0) {
    log.info(
      `Expiry cycle: memories_expired=${result.memoriesExpired} memories_demoted=${result.memoriesDemoted} facts_stale=${result.factsStale} facts_expired=${result.factsExpired} knowledge_expired=${result.knowledgeExpired}`,
    );
  }

  return result;
}

/**
 * Expire memories older than 30 days with no recent access.
 * Demote high-importance but untouched memories (reduce their importance).
 */
function expireMemories(
  memories: SoulMemory[],
  now: number,
): { expired: number; demoted: number; remaining: SoulMemory[] } {
  let expired = 0;
  let demoted = 0;

  const remaining = memories.filter((m) => {
    const age = now - m.timestamp;
    const lastAccess = m.lastAccessedAt ?? m.timestamp;
    const timeSinceAccess = now - lastAccess;

    // Never expire long-term memories that have been accessed recently
    if (timeSinceAccess < THIRTY_DAYS_MS) {
      return true;
    }

    // 30+ days since last access — check importance
    if (m.importance < 0.4) {
      // Low importance: expire
      expired++;
      return false;
    }

    // Higher importance but stale: keep but don't remove — will be demoted below
    return true;
  });

  // Demote stale but important memories (reduce importance over time)
  for (const m of remaining) {
    const timeSinceAccess = now - (m.lastAccessedAt ?? m.timestamp);
    if (timeSinceAccess > THIRTY_DAYS_MS && m.importance > 0.3) {
      // Decay importance by 20% per 30-day period of no access
      const periodsSinceAccess = Math.floor(timeSinceAccess / THIRTY_DAYS_MS);
      const decayedImportance = m.importance * Math.pow(0.8, periodsSinceAccess);
      if (decayedImportance < m.importance - 0.01) {
        m.importance = Math.max(0.1, decayedImportance);
        demoted++;
      }
    }

    // Decay short-term memories with low access
    const tier = m.tier ?? "short-term";
    if (tier === "short-term") {
      const accessCount = m.accessCount ?? 0;
      if (accessCount === 0 && (now - m.timestamp) > SEVEN_DAYS_MS) {
        // No access in 7 days — increase decay factor
        m.decayFactor = Math.min(m.decayFactor ?? 1, 0.5);
      }
    }
  }

  return { expired, demoted, remaining };
}

/**
 * Process stale userFacts:
 * - Low-confidence facts (>14 days old, never confirmed): reduce confidence
 * - Very low confidence (<0.2): expire
 * - High-confidence but old (>60 days, not confirmed recently): mark for re-verification
 */
function processStaleFacts(facts: UserFact[], now: number): { stale: number; expired: number } {
  let stale = 0;
  let expired = 0;

  const toRemove = new Set<string>();

  for (const fact of facts) {
    const age = now - fact.firstMentionedAt;

    // Expire very low confidence facts that are old
    if (fact.confidence < 0.2 && age > SEVEN_DAYS_MS) {
      toRemove.add(fact.id);
      expired++;
      continue;
    }

    // Decay unconfirmed facts over time
    if (fact.timesConfirmed <= 1 && age > SEVEN_DAYS_MS) {
      const decayedConfidence = fact.confidence * 0.9;
      if (decayedConfidence < 0.2) {
        toRemove.add(fact.id);
        expired++;
      } else {
        fact.confidence = decayedConfidence;
        stale++;
      }
    }
  }

  // Remove expired facts
  const filtered = facts.filter((f) => !toRemove.has(f.id));
  // Replace in-place (since we're inside updateEgoStore mutator)
  facts.length = 0;
  facts.push(...filtered);

  return { stale, expired };
}

/**
 * Expire knowledge items older than 30 days with low access count.
 */
async function expireKnowledge(now: number): Promise<number> {
  let expired = 0;

  await updateKnowledgeStore(undefined, (store) => {
    const remaining = store.items.filter((item) => {
      const age = now - item.learnedAt;

      // Keep recently accessed items
      if (item.lastAccessedAt && (now - item.lastAccessedAt) < THIRTY_DAYS_MS) {
        return true;
      }

      // Keep high-access items
      if (item.accessCount >= 3) {
        return true;
      }

      // Expire items older than 30 days with low access
      if (age > THIRTY_DAYS_MS && item.accessCount < 2) {
        expired++;
        return false;
      }

      // Expire items older than 60 days with moderate access
      if (age > 2 * THIRTY_DAYS_MS && item.accessCount < 5) {
        expired++;
        return false;
      }

      return true;
    });

    store.items = remaining;
    return store;
  });

  return expired;
}
