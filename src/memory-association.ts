import type { SoulMemory, MemoryAssociation } from "./types.js";

export interface AssociationResult {
  newMemoryAssociations: MemoryAssociation[];
  reversePatches: Array<{ memoryId: string; association: MemoryAssociation }>;
}

export function buildAssociations(
  newMemory: SoulMemory,
  existingMemories: SoulMemory[],
  maxAssociations = 10,
): AssociationResult {
  const candidates: Array<{
    memoryId: string;
    strength: number;
    reason: string;
  }> = [];

  for (const existing of existingMemories) {
    if (existing.id === newMemory.id) continue;

    let strength = 0;
    let bestReason = "topic-overlap";

    // Shared tags: +0.3 per shared tag
    const sharedTags = newMemory.tags.filter((t) => existing.tags.includes(t));
    if (sharedTags.length > 0) {
      strength += sharedTags.length * 0.3;
      bestReason = `shared-tag:${sharedTags[0]}`;
    }

    // Temporal proximity: +0.2 within 5 min, +0.1 within 1 hour
    const timeDiffMs = Math.abs(newMemory.timestamp - existing.timestamp);
    if (timeDiffMs < 5 * 60 * 1000) {
      strength += 0.2;
      if (bestReason.startsWith("shared-tag")) {
        // keep tag reason, it's more specific
      } else {
        bestReason = "temporal-proximity";
      }
    } else if (timeDiffMs < 60 * 60 * 1000) {
      strength += 0.1;
    }

    // Content overlap: bigram matching (+0.15 for >3 shared bigrams)
    const newBigrams = extractBigrams(newMemory.content);
    const existingBigrams = extractBigrams(existing.content);
    const sharedBigrams = newBigrams.filter((b) => existingBigrams.includes(b));
    if (sharedBigrams.length > 3) {
      strength += 0.15;
      if (!bestReason.startsWith("shared-tag")) {
        bestReason = "topic-overlap";
      }
    }

    if (strength > 0.05) {
      candidates.push({
        memoryId: existing.id,
        strength: Math.min(1, strength),
        reason: bestReason,
      });
    }
  }

  // Sort by strength, keep top N
  candidates.sort((a, b) => b.strength - a.strength);
  const topCandidates = candidates.slice(0, maxAssociations);

  const now = Date.now();

  const newMemoryAssociations: MemoryAssociation[] = topCandidates.map((c) => ({
    targetId: c.memoryId,
    strength: c.strength,
    reason: c.reason,
    createdAt: now,
  }));

  // Build symmetric reverse associations
  const reversePatches: Array<{ memoryId: string; association: MemoryAssociation }> =
    topCandidates.map((c) => ({
      memoryId: c.memoryId,
      association: {
        targetId: newMemory.id,
        strength: c.strength,
        reason: c.reason,
        createdAt: now,
      },
    }));

  return { newMemoryAssociations, reversePatches };
}

export function applyReverseAssociations(
  memories: SoulMemory[],
  patches: Array<{ memoryId: string; association: MemoryAssociation }>,
  maxAssociations = 10,
): void {
  for (const patch of patches) {
    const target = memories.find((m) => m.id === patch.memoryId);
    if (!target) continue;

    if (!target.associations) {
      target.associations = [];
    }

    // Don't duplicate
    if (target.associations.some((a) => a.targetId === patch.association.targetId)) {
      continue;
    }

    target.associations.push(patch.association);

    // Cap associations, keep strongest
    if (target.associations.length > maxAssociations) {
      target.associations.sort((a, b) => b.strength - a.strength);
      target.associations = target.associations.slice(0, maxAssociations);
    }
  }
}

// Extract character bigrams from text, handling both CJK and Latin
export function extractBigrams(text: string): string[] {
  if (!text || text.length < 2) return [];

  const bigrams: string[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    const ch = text[i];
    const next = text[i + 1];
    // Skip whitespace and punctuation boundaries
    if (isWordChar(ch) && isWordChar(next)) {
      bigrams.push(ch + next);
    }
  }
  return bigrams;
}

function isWordChar(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  // CJK Unified Ideographs
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  // CJK Extension A
  if (code >= 0x3400 && code <= 0x4dbf) return true;
  // Latin letters
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return true;
  // Digits
  if (code >= 0x30 && code <= 0x39) return true;
  return false;
}
