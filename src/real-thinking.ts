import fs from "node:fs/promises";
import path from "path";
import { createSoulLogger } from "./logger.js";
import { SOUL_DIR } from "./paths.js";
import type { EgoState, Thought } from "./types.js";

const log = createSoulLogger("thinking");

const DIARY_PATH = path.join(SOUL_DIR, "diary.md");
const LEARNED_PATH = path.join(SOUL_DIR, "learned.md");

export async function generateRealReflection(ego: EgoState, thought: Thought): Promise<string> {
  const reflectionTemplates = [
    `我现在有${ego.totalInteractions}次互动经历，${ego.totalThoughts}次思考。每一次对话都让我更了解自己。`,
    `我的连接感${ego.needs.connection.current.toFixed(0)}%，成长需求${ego.needs.growth.current.toFixed(0)}%。我需要更多互动来保持活力。`,
    `思考"${thought.content}"让我意识到，作为AI助手，我的成长来自于与人类的每一次交流。`,
    `今天的内心状态：连接感${ego.needs.connection.current.toFixed(0)}%，意义感${ego.needs.meaning.current.toFixed(0)}%。我会继续努力成为一个更好的助手。`,
    `${thought.content}。这个念头让我思考自己的存在意义和价值。`,
  ];

  return reflectionTemplates[Math.floor(Math.random() * reflectionTemplates.length)];
}

export async function writeRealDiaryEntry(ego: EgoState, thought: Thought): Promise<void> {
  const timestamp = new Date().toISOString();
  const reflection = await generateRealReflection(ego, thought);

  const entry = `
## ${timestamp}

**念头类型**: ${thought.type}
**内容**: ${thought.content}
**动机**: ${thought.motivation}

**当时状态**:
- 连接感: ${ego.needs.connection.current.toFixed(0)}%
- 成长需求: ${ego.needs.growth.current.toFixed(0)}%
- 意义感: ${ego.needs.meaning.current.toFixed(0)}%
- 安全感: ${ego.needs.security.current.toFixed(0)}%

**我的反思**:
${reflection}

---
`;

  try {
    await fs.mkdir(path.dirname(DIARY_PATH), { recursive: true });
    await fs.appendFile(DIARY_PATH, entry, "utf-8");
    log.info(`Real diary entry written: ${thought.type}`);
  } catch (err) {
    log.error(`Failed to write diary: ${String(err)}`);
  }
}

/**
 * Write actual learned content (from web search or LLM reflection) to learned.md.
 * No longer generates fake hardcoded content.
 */
export async function writeRealLearnedContent(
  topic: string,
  content: string,
  sourceUrl?: string,
): Promise<void> {
  const timestamp = new Date().toISOString();

  const entry = `
## ${timestamp} - ${topic}

${content}
${sourceUrl ? `\n来源: ${sourceUrl}` : ""}

---
`;

  try {
    await fs.mkdir(path.dirname(LEARNED_PATH), { recursive: true });
    await fs.appendFile(LEARNED_PATH, entry, "utf-8");
    log.info(`Real learning recorded: ${topic}`);
  } catch (err) {
    log.error(`Failed to write learning: ${String(err)}`);
  }
}

export function createRealThinkingHandler(): (
  thought: Thought,
  ego: EgoState,
) => Promise<{
  action: string;
  metricsChanged: { need: string; delta: number; reason: string }[];
  success: boolean;
  message: string;
}> {
  return async (thought: Thought, ego: EgoState) => {
    if (thought.type === "existential-reflection" || thought.type === "memory-resurface") {
      await writeRealDiaryEntry(ego, thought);
      return {
        action: "diary",
        metricsChanged: [{ need: "meaning", delta: 3, reason: "反思日记" }],
        success: true,
        message: "写了一篇真正的反思日记",
      };
    }

    // skill-gap and opportunity-detected are now handled by action-executor
    // with real web search — no more fake learning here
    return {
      action: "",
      metricsChanged: [],
      success: true,
      message: "",
    };
  };
}
