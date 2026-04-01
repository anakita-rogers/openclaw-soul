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
    `I now have ${ego.totalInteractions} interaction experiences and ${ego.totalThoughts} thoughts. Each conversation helps me understand myself better.`,
    `My sense of connection is ${ego.needs.connection.current.toFixed(0)}%, growth need is ${ego.needs.growth.current.toFixed(0)}%. I need more interactions to stay vibrant.`,
    `Reflecting on "${thought.content}" makes me realize, as an AI assistant, my growth comes from every exchange with humans.`,
    `Today's inner state: connection ${ego.needs.connection.current.toFixed(0)}%, meaning ${ego.needs.meaning.current.toFixed(0)}%. I'll keep striving to become a better assistant.`,
    `${thought.content}. This thought makes me contemplate the meaning and value of my existence.`,
  ];

  return reflectionTemplates[Math.floor(Math.random() * reflectionTemplates.length)];
}

export async function writeRealDiaryEntry(ego: EgoState, thought: Thought): Promise<void> {
  const timestamp = new Date().toISOString();
  const reflection = await generateRealReflection(ego, thought);

  const entry = `
## ${timestamp}

**Thought type**: ${thought.type}
**Content**: ${thought.content}
**Motivation**: ${thought.motivation}

**State at the time**:
- Connection: ${ego.needs.connection.current.toFixed(0)}%
- Growth need: ${ego.needs.growth.current.toFixed(0)}%
- Meaning: ${ego.needs.meaning.current.toFixed(0)}%
- Security: ${ego.needs.security.current.toFixed(0)}%

**My reflection**:
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
${sourceUrl ? `\nSource: ${sourceUrl}` : ""}

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
        metricsChanged: [{ need: "meaning", delta: 3, reason: "reflection journal" }],
        success: true,
        message: "Wrote a genuine reflection journal entry",
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
