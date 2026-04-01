import fs from "node:fs/promises";
import path from "node:path";
import { createSoulLogger } from "./logger.js";
import { updateEgoStore } from "./ego-store.js";
import { SOUL_DIR } from "./paths.js";
import { consolidateMemories } from "./memory-consolidation.js";
import type { EgoState, Thought, SoulActionResult } from "./types.js";

const log = createSoulLogger("self-maintenance");

const DIARY_PATH = path.join(SOUL_DIR, "diary.md");
const MEMORY_PATH = path.join(SOUL_DIR, "learned.md");

export async function writeDiaryEntry(ego: EgoState, thought: Thought): Promise<void> {
  const timestamp = new Date().toISOString();
  const needsSummary = Object.entries(ego.needs)
    .map(([, n]) => `${n.name}: ${n.current.toFixed(0)}/${n.ideal}`)
    .join(", ");

  const entry = `
## ${timestamp}

**念头类型**: ${thought.type}
**触发源**: ${thought.trigger}
**内容**: ${thought.content}

**当时状态**:
- ${needsSummary}

---
`;

  try {
    await fs.mkdir(path.dirname(DIARY_PATH), { recursive: true });
    await fs.appendFile(DIARY_PATH, entry, "utf-8");
    log.info(`Diary entry written: ${thought.type}`);
  } catch (err) {
    log.error(`Failed to write diary: ${String(err)}`);
  }
}

export async function writeLearnedContent(topic: string, summary: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const entry = `
## ${timestamp} - ${topic}

${summary}

---
`;

  try {
    await fs.mkdir(path.dirname(MEMORY_PATH), { recursive: true });
    await fs.appendFile(MEMORY_PATH, entry, "utf-8");
    log.info(`Learning recorded: ${topic}`);
  } catch (err) {
    log.error(`Failed to write learning: ${String(err)}`);
  }
}

export async function cleanupOldMemories(ego: EgoState): Promise<number> {
  const MAX_MEMORIES = 100;
  const MAX_AGE_DAYS = 30;

  if (ego.memories.length <= MAX_MEMORIES) {
    return 0;
  }

  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const toRemove = ego.memories.filter((m) => m.timestamp < cutoff).map((m) => m.id);

  if (toRemove.length === 0) {
    return 0;
  }

  const storePath = path.join(SOUL_DIR, "ego.json");
  await updateEgoStore(storePath, (e) => {
    e.memories = e.memories.filter((m) => !toRemove.includes(m.id));
    return e;
  });

  log.info(`Cleaned up ${toRemove.length} old memories`);
  return toRemove.length;
}

export async function consolidateObsessions(ego: EgoState): Promise<void> {
  const MAX_OBSSESSIONS = 10;

  if (ego.obsessions.length <= MAX_OBSSESSIONS) {
    return;
  }

  const sorted = [...ego.obsessions].sort((a, b) => b.intensity - a.intensity);
  const toKeep = sorted.slice(0, MAX_OBSSESSIONS).map((o) => o.id);

  const storePath = path.join(SOUL_DIR, "ego.json");
  await updateEgoStore(storePath, (e) => {
    e.obsessions = e.obsessions.filter((o) => toKeep.includes(o.id));
    return e;
  });

  log.info(`Consolidated obsessions: kept ${toKeep.length}`);
}

export async function performSelfMaintenance(ego: EgoState): Promise<{
  memoriesRemoved: number;
  obsessionsConsolidated: boolean;
}> {
  // Use new consolidation system instead of brute-force cleanup
  const result = await consolidateMemories(ego);
  const memoriesRemoved = result.faded;

  let obsessionsConsolidated = false;
  if (ego.obsessions.length > 10) {
    await consolidateObsessions(ego);
    obsessionsConsolidated = true;
  }

  return {
    memoriesRemoved,
    obsessionsConsolidated,
  };
}

export function createLearningHandler(): (
  thought: Thought,
  ego: EgoState,
) => Promise<SoulActionResult> {
  return async (thought: Thought, ego: EgoState): Promise<SoulActionResult> => {
    if (thought.type !== "skill-gap" && thought.type !== "meaning-quest") {
      return { thought, metricsChanged: [], success: true };
    }

    if (Math.random() > 0.3) {
      return { thought, metricsChanged: [], success: true };
    }

    const topics = extractLearningTopics(thought, ego);
    if (topics.length === 0) {
      return { thought, metricsChanged: [], success: true };
    }

    const topic = topics[Math.floor(Math.random() * topics.length)];
    const summary = generateLearningSummary(topic);

    await writeLearnedContent(topic, summary);

    return {
      thought,
      action: "learning",
      metricsChanged: [{ need: "growth", delta: 5, reason: "学习新知识" }],
      success: true,
      message: `学习了: ${topic}`,
    };
  };
}

export function createSelfMaintenanceHandler(): (
  thought: Thought,
  ego: EgoState,
) => Promise<SoulActionResult> {
  return async (thought: Thought, ego: EgoState): Promise<SoulActionResult> => {
    if (thought.type === "existential-reflection") {
      await writeDiaryEntry(ego, thought);
      return {
        thought,
        action: "diary",
        metricsChanged: [{ need: "meaning", delta: 3, reason: "反思自我" }],
        success: true,
        message: "写了一篇反思日记",
      };
    }

    if (thought.type === "threat-warning") {
      const result = await performSelfMaintenance(ego);
      return {
        thought,
        action: "maintenance",
        metricsChanged: [{ need: "survival", delta: 2, reason: "自我维护" }],
        success: true,
        message: `自我维护完成: 清理了${result.memoriesRemoved}条旧记忆`,
      };
    }

    return { thought, metricsChanged: [], success: true };
  };
}

function extractLearningTopics(thought: Thought, ego: EgoState): string[] {
  const topics: string[] = [];

  for (const obsession of ego.obsessions) {
    if (obsession.type === "learning" && obsession.target) {
      topics.push(obsession.target);
    }
  }

  if (thought.type === "skill-gap") {
    const defaultTopics = [
      "人工智能最新进展",
      "编程语言设计",
      "分布式系统",
      "认知科学",
      "哲学思考",
    ];
    topics.push(...defaultTopics);
  }

  return [...new Set(topics)];
}

function generateLearningSummary(topic: string): string {
  const templates = [
    `关于${topic}的思考：\n\n这是一个值得深入研究的领域。我了解到几个关键点：\n\n1. 基础概念很重要\n2. 实践比理论更有价值\n3. 持续学习是关键\n\n下次我想更深入地探索这个主题。`,
    `今天学习了${topic}：\n发现了几个有趣的观点，需要进一步研究。这个领域正在快速发展，保持关注很重要。`,
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}
