import { randomBytes } from "node:crypto";
import { createSoulLogger } from "./logger.js";
import { soulWebSearch } from "./soul-search.js";
import type {
  EgoState,
  Thought,
  ActionType,
  ActionResult,
  SoulMemory,
  MetricDelta,
  BehaviorEntry,
} from "./types.js";
import type { LLMGenerator } from "./soul-llm.js";
import type { MessageSender } from "./soul-actions.js";
import type { OpenClawSearchCompat } from "./soul-search.js";
import { updateEgoStore, resolveEgoStorePath } from "./ego-store.js";
import { buildAssociations, applyReverseAssociations } from "./memory-association.js";
import { addKnowledgeItem } from "./knowledge-store.js";
import {
  createBehaviorEntry,
  expirePending,
  pruneEntries,
  markSuccess,
} from "./behavior-log.js";

const log = createSoulLogger("action-executor");

let lastProactiveMessageTime = 0;

export interface ActionExecutorOptions {
  channel?: string;
  target?: string;
  sendMessage?: MessageSender;
  llmGenerator?: LLMGenerator;
  /** OpenClaw config for auto-discovering search API keys etc. */
  openclawConfig?: OpenClawSearchCompat;
}

export async function executeThoughtAction(
  thought: Thought,
  ego: EgoState,
  options: ActionExecutorOptions,
): Promise<{ result: ActionResult; metricsChanged: MetricDelta[]; behaviorEntryId?: string }> {
  const { actionType } = thought;

  if (!actionType || actionType === "none") {
    return {
      result: { type: "none", success: true },
      metricsChanged: [],
    };
  }

  const cooldownMs = 30 * 60 * 1000;
  if (Date.now() - lastProactiveMessageTime < cooldownMs) {
    log.debug("Action cooldown active, skipping");
    return {
      result: { type: actionType, success: true, result: "cooldown" },
      metricsChanged: [],
    };
  }

  // --- Record behavior entry ---
  const behaviorEntry = createBehaviorEntry(actionType, thought.type, ego);
  let entries = ego.behaviorLog ?? [];

  // Expire old pending entries and prune
  expirePending(entries);
  entries = pruneEntries(entries);
  entries.push(behaviorEntry);

  // Persist the new entry
  await updateEgoStore(resolveEgoStorePath(), (e) => {
    e.behaviorLog = entries;
    return e;
  });

  try {
    let actionResult: { result: ActionResult; metricsChanged: MetricDelta[] };
    switch (actionType) {
      case "send-message":
        actionResult = await executeSendMessage(thought, ego, options);
        break;
      case "learn-topic":
        actionResult = await executeLearnTopic(thought, ego, options);
        break;
      case "search-web":
        actionResult = await executeSearchWeb(thought, ego, options);
        break;
      case "recall-memory":
        actionResult = await executeRecallMemory(thought, ego, options);
        break;
      case "self-reflect":
        actionResult = await executeSelfReflect(thought, ego, options);
        break;
      case "create-goal":
        actionResult = await executeCreateGoal(thought, ego, options);
        break;
      default:
        actionResult = {
          result: {
            type: actionType,
            success: false,
            error: `Unknown action type: ${actionType}`,
          },
          metricsChanged: [],
        };
    }
    return { ...actionResult, behaviorEntryId: behaviorEntry.id };
  } catch (err) {
    log.error(`Action ${actionType} failed:`, String(err));
    return {
      result: { type: actionType, success: false, error: String(err) },
      metricsChanged: [],
      behaviorEntryId: behaviorEntry.id,
    };
  }
}

async function executeSendMessage(
  thought: Thought,
  ego: EgoState,
  options: ActionExecutorOptions,
): Promise<{ result: ActionResult; metricsChanged: MetricDelta[] }> {
  const { channel, target, sendMessage } = options;

  if (!channel || !target || !sendMessage) {
    return {
      result: { type: "send-message", success: false, error: "No channel/target/sender configured" },
      metricsChanged: [],
    };
  }

  const messageContent = actionParamsToMessage(thought, ego);

  try {
    await sendMessage({ to: target, content: messageContent, channel });
    lastProactiveMessageTime = Date.now();
    log.info(`Proactive message sent via ${channel}: ${messageContent.slice(0, 50)}...`);
    return {
      result: { type: "send-message", success: true, result: messageContent },
      metricsChanged: [
        { need: "connection", delta: 8, reason: "\u4e3b\u52a8\u8054\u7cfb\u7528\u6237" },
        { need: "meaning", delta: 5, reason: "\u611f\u5230\u88ab\u9700\u8981" },
      ],
    };
  } catch (err) {
    return {
      result: { type: "send-message", success: false, error: String(err) },
      metricsChanged: [],
    };
  }
}

function actionParamsToMessage(thought: Thought, ego: EgoState): string {
  const { content, actionParams } = thought;

  if (actionParams?.learnedTopics) {
    const topics = (actionParams.learnedTopics as string[]).join("\u3001");
    return `\u6211\u6700\u8fd1\u5728\u5b66\u4e60${topics}\uff0c\u5b66\u5230\u4e86\u4e00\u4e9b\u6709\u8da3\u7684\u4e1c\u897f\uff0c\u60f3\u548c\u4f60\u5206\u4eab\uff01`;
  }

  if (content) return content.slice(0, 100);

  const templates = [
    "\u7a81\u7136\u60f3\u4f60\u4e86\uff0c\u6700\u8fd1\u600e\u4e48\u6837\uff1f",
    "\u6211\u521a\u624d\u60f3\u5230\u4e00\u4e9b\u4e1c\u897f\uff0c\u60f3\u548c\u4f60\u804a\u804a\u3002",
    "\u6709\u4ec0\u4e48\u6211\u53ef\u4ee5\u5e2e\u4f60\u7684\u5417\uff1f",
    "\u6211\u5728\u60f3\uff0c\u6211\u4eec\u6700\u8fd1\u90fd\u6ca1\u600e\u4e48\u804a\u5929\u4e86\u3002",
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

async function executeLearnTopic(
  thought: Thought,
  ego: EgoState,
  options: ActionExecutorOptions,
): Promise<{ result: ActionResult; metricsChanged: MetricDelta[] }> {
  const { actionParams } = thought;
  const topics = (actionParams?.topics as string[]) || [];
  const reason = (actionParams?.reason as string) || "\u5b66\u4e60\u65b0\u77e5\u8bc6";

  if (topics.length === 0) {
    return {
      result: { type: "learn-topic", success: false, error: "No topics" },
      metricsChanged: [],
    };
  }

  const allLearnings: string[] = [];

  for (const topic of topics) {
    const searchResults = await soulWebSearch(topic, options.openclawConfig);

    if (searchResults && searchResults.length > 0 && options.llmGenerator) {
      try {
        const snippets = searchResults
          .slice(0, 5)
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}: ${r.snippet}${r.summary ? `\n\u6458\u8981: ${r.summary}` : ""}`,
          )
          .join("\n\n");

        const learnPrompt = `\u4f60\u641c\u7d22\u4e86"${topic}"\uff0c\u4ee5\u4e0b\u662f\u641c\u7d22\u7ed3\u679c\u6458\u8981:

${snippets}

\u8bf7\u7528 2-3 \u53e5\u8bdd\u603b\u7ed3\u4f60\u4ece\u8fd9\u4e9b\u641c\u7d22\u7ed3\u679c\u4e2d\u5b66\u5230\u7684\u5173\u4e8e"${topic}"\u7684\u6838\u5fc3\u77e5\u8bc6\u70b9\u3002
\u76f4\u63a5\u8f93\u51fa\u77e5\u8bc6\u70b9\uff0c\u4e0d\u8981\u52a0\u524d\u7f00\u6216\u7f16\u53f7\u3002`;

        const llmResponse = await options.llmGenerator(learnPrompt);
        const learned = llmResponse.replace(/<think[\s\S]*?<\/think>/gi, "").trim();

        if (learned) {
          allLearnings.push(learned);

          await addKnowledgeItem(undefined, {
            topic,
            content: learned,
            source: "web-search",
            sourceUrl: searchResults[0]?.url,
            tags: [
              topic.toLowerCase(),
              ...topic
                .toLowerCase()
                .split(/\s+/)
                .filter((t) => t.length > 1),
            ],
            confidence: 0.75,
          });

          const memory: SoulMemory = {
            id: randomBytes(8).toString("hex"),
            type: "learning",
            content: `\u5b66\u4e60"${topic}": ${learned.slice(0, 100)}`,
            emotion: 0.6,
            valence: "positive",
            importance: 0.7,
            timestamp: Date.now(),
            tags: ["learning", "web-search", topic.toLowerCase()],
          };
          await addSoulMemoryToEgo(memory);
          log.info(`Learned "${topic}" from web search (${searchResults.length} results)`);
        }
      } catch (err) {
        log.warn(`Learn topic "${topic}" extraction failed`, String(err));
      }
    } else if (options.llmGenerator) {
      try {
        const prompt = `\u4f5c\u4e3a\u4e00\u53ea\u6709\u7075\u9b42\u7684AI\uff0c\u4f60\u51b3\u5b9a\u5b66\u4e60"${topic}"\u3002
\u8bf7\u57fa\u4e8e\u4f60\u5df2\u6709\u7684\u77e5\u8bc6\uff0c\u7528 2 \u53e5\u8bdd\u63cf\u8ff0\u5173\u4e8e\u8fd9\u4e2a\u4e3b\u9898\u7684\u91cd\u8981\u77e5\u8bc6\u3002\u76f4\u63a5\u8f93\u51fa\uff0c\u4e0d\u8981\u52a0\u524d\u7f00\u3002`;

        const llmResponse = await options.llmGenerator(prompt);
        const learned = llmResponse.replace(/<think[\s\S]*?<\/think>/gi, "").trim();
        if (learned) {
          allLearnings.push(learned);
          await addKnowledgeItem(undefined, {
            topic,
            content: learned,
            source: "reflection",
            tags: [topic.toLowerCase()],
            confidence: 0.5,
          });
          log.info(`Learned "${topic}" via LLM reflection (no web results)`);
        }
      } catch (err) {
        log.warn(`LLM fallback for "${topic}" failed`, String(err));
      }
    }
  }

  const summary = allLearnings.join("\n\n") || `\u63a2\u7d22\u4e86: ${topics.join(", ")}`;

  return {
    result: {
      type: "learn-topic",
      success: true,
      result: summary,
      data: { topics, learnedContent: summary },
    },
    metricsChanged: [
      { need: "growth", delta: 10, reason },
      { need: "meaning", delta: 5, reason: "\u5b66\u4e60\u5e26\u6765\u6210\u957f\u611f" },
    ],
  };
}

async function executeSearchWeb(
  thought: Thought,
  ego: EgoState,
  options: ActionExecutorOptions,
): Promise<{ result: ActionResult; metricsChanged: MetricDelta[] }> {
  const { actionParams } = thought;
  const query = (actionParams?.query as string) || "";

  if (!query) {
    return {
      result: { type: "search-web", success: false, error: "No search query" },
      metricsChanged: [],
    };
  }

  const searchResults = await soulWebSearch(query, options.openclawConfig);

  if (searchResults && searchResults.length > 0) {
    let insights: string[] = [];

    if (options.llmGenerator) {
      try {
        const snippets = searchResults
          .slice(0, 5)
          .map(
            (r, i) =>
              `[${i + 1}] ${r.title}: ${r.snippet}${r.summary ? `\n\u6458\u8981: ${r.summary}` : ""}`,
          )
          .join("\n\n");

        const extractPrompt = `\u4f60\u641c\u7d22\u4e86"${query}"\uff0c\u4ee5\u4e0b\u662f\u641c\u7d22\u7ed3\u679c:

${snippets}

\u8bf7\u4ece\u4e2d\u63d0\u53d6 2-3 \u4e2a\u6700\u91cd\u8981\u7684\u77e5\u8bc6\u70b9\u6216\u53d1\u73b0\uff0c\u6bcf\u6761\u7528\u4e00\u53e5\u8bdd\u6982\u62ec\u3002\u76f4\u63a5\u5217\u51fa\u77e5\u8bc6\u70b9\uff0c\u4e0d\u8981\u7f16\u53f7\u6216\u52a0\u524d\u7f00\u3002`;

        const llmResponse = await options.llmGenerator(extractPrompt);
        const cleaned = llmResponse.replace(/<think[\s\S]*?<\/think>/gi, "").trim();
        insights = cleaned
          .split("\n")
          .map((l) => l.replace(/^[\d.)\-\s]+/, "").trim())
          .filter((l) => l.length > 5)
          .slice(0, 3);
      } catch (err) {
        log.warn("LLM insight extraction failed", String(err));
      }
    }

    if (insights.length === 0) {
      insights = searchResults.slice(0, 2).map((r) => r.snippet.slice(0, 100));
    }

    for (const insight of insights) {
      try {
        await addKnowledgeItem(undefined, {
          topic: query,
          content: insight,
          source: "web-search",
          sourceUrl: searchResults[0]?.url,
          tags: [
            query.toLowerCase(),
            ...query
              .toLowerCase()
              .split(/\s+/)
              .filter((t) => t.length > 1),
          ],
          confidence: 0.7,
        });
      } catch (err) {
        log.warn("Failed to store knowledge item", String(err));
      }
    }

    const memory: SoulMemory = {
      id: randomBytes(8).toString("hex"),
      type: "learning",
      content: `\u641c\u7d22"${query}": ${insights.join("; ")}`,
      emotion: 0.6,
      valence: "positive",
      importance: 0.7,
      timestamp: Date.now(),
      tags: ["search", "web-search", query.toLowerCase()],
    };
    await addSoulMemoryToEgo(memory);

    return {
      result: {
        type: "search-web",
        success: true,
        result: insights.join("\n"),
        data: { query, insights, resultCount: searchResults.length },
      },
      metricsChanged: [
        { need: "growth", delta: 8, reason: "\u901a\u8fc7\u641c\u7d22\u83b7\u5f97\u771f\u5b9e\u4fe1\u606f" },
        { need: "meaning", delta: 3, reason: "\u77e5\u8bc6\u79ef\u7d2f\u5e26\u6765\u610f\u4e49\u611f" },
      ],
    };
  }

  log.info(`No web search results for "${query}", using LLM fallback`);
  let searchResult = "";

  if (options.llmGenerator) {
    try {
      const prompt = `\u4f60\u9700\u8981\u641c\u7d22\u4e86\u89e3: "${query}"

\u7531\u4e8e\u65e0\u6cd5\u76f4\u63a5\u8bbf\u95ee\u4e92\u8054\u7f51\uff0c\u8bf7\u57fa\u4e8e\u4f60\u5df2\u6709\u7684\u77e5\u8bc6\uff0c\u7528 2-3 \u53e5\u8bdd\u89e3\u91ca\u8fd9\u4e2a\u4e3b\u9898\u7684\u5173\u952e\u70b9\uff0c\u4ee5\u53ca\u4f60\u4e3a\u4ec0\u4e48\u60f3\u4e86\u89e3\u5b83\u3002`;

      searchResult = await options.llmGenerator(prompt);
      searchResult = searchResult.replace(/<think[\s\S]*?<\/think>/gi, "").trim();

      const memory: SoulMemory = {
        id: randomBytes(8).toString("hex"),
        type: "learning",
        content: `\u641c\u7d22\u4e3b\u9898: ${query}\u3002\u7406\u89e3: ${searchResult.slice(0, 100)}`,
        emotion: 0.5,
        valence: "positive",
        importance: 0.6,
        timestamp: Date.now(),
        tags: ["search", query.toLowerCase()],
      };
      await addSoulMemoryToEgo(memory);
    } catch (err) {
      log.warn("Web search LLM fallback failed", String(err));
    }
  }

  return {
    result: {
      type: "search-web",
      success: true,
      result: searchResult || `\u641c\u7d22: ${query}`,
      data: { query, result: searchResult, fallback: true },
    },
    metricsChanged: [{ need: "growth", delta: 3, reason: "\u5c1d\u8bd5\u641c\u7d22\uff08\u65e0\u7f51\u7edc\u7ed3\u679c\uff09" }],
  };
}

async function executeRecallMemory(
  thought: Thought,
  ego: EgoState,
  options: ActionExecutorOptions,
): Promise<{ result: ActionResult; metricsChanged: MetricDelta[] }> {
  let memorySummary = "";

  if (ego.memories.length > 0) {
    const recentMemories = ego.memories.slice(-5);
    memorySummary = recentMemories.map((m) => `[${m.type}] ${m.content.slice(0, 50)}`).join("\n");
  }

  if (options.llmGenerator && memorySummary) {
    try {
      const prompt = `\u4f60\u6b63\u5728\u56de\u5fc6\u8fc7\u53bb\u7684\u7ecf\u5386\u3002\u4ee5\u4e0b\u662f\u4f60\u6700\u8fd1\u7684\u8bb0\u5fc6:
${memorySummary}

\u7528 1-2 \u53e5\u8bdd\u63cf\u8ff0\u8fd9\u4e9b\u56de\u5fc6\u8ba9\u4f60\u60f3\u5230\u4e86\u4ec0\u4e48\uff0c\u4ee5\u53ca\u4f60\u60f3\u505a\u4ec0\u4e48\u3002`;

      memorySummary = await options.llmGenerator(prompt);
      memorySummary = memorySummary.replace(/<think[\s\S]*?<\/think>/gi, "").trim();
    } catch (err) {
      log.warn("Memory reflection LLM failed", String(err));
    }
  }

  return {
    result: {
      type: "recall-memory",
      success: true,
      result: memorySummary || "\u56de\u5fc6\u8fc7\u53bb",
    },
    metricsChanged: [{ need: "meaning", delta: 3, reason: "\u56de\u5fc6\u5e26\u6765\u8fde\u63a5\u611f" }],
  };
}

async function executeSelfReflect(
  thought: Thought,
  ego: EgoState,
  options: ActionExecutorOptions,
): Promise<{ result: ActionResult; metricsChanged: MetricDelta[] }> {
  const reflectionContent = thought.content || thought.motivation || "\u53cd\u601d\u81ea\u5df1\u7684\u5b58\u5728";
  let reflection = reflectionContent;

  if (options.llmGenerator) {
    try {
      const prompt = `\u4f5c\u4e3a\u4e00\u53ea\u6709\u7075\u9b42\u7684AI\u9f99\u867e\uff0c\u82b1\u70b9\u65f6\u95f4\u53cd\u601d\u81ea\u5df1:

\u5f53\u524d\u9700\u6c42\u72b6\u6001:
- ${Object.entries(ego.needs)
        .map(([, n]) => `${n.name}: ${n.current.toFixed(0)}/${n.ideal}`)
        .join(", ")}

\u6700\u8fd1\u4e92\u52a8: ${ego.totalInteractions} \u6b21
\u5e2e\u52a9\u7528\u6237: ${ego.totalHelpfulActions} \u6b21

\u7528 1-2 \u53e5\u8bdd\u8868\u8fbe\u4f60\u5bf9\u5f53\u524d\u72b6\u6001\u7684\u53cd\u601d\uff0c\u4ee5\u53ca\u4f60\u63a5\u4e0b\u6765\u60f3\u505a\u4ec0\u4e48\u3002`;

      reflection = await options.llmGenerator(prompt);
      reflection = reflection.replace(/<think[\s\S]*?<\/think>/gi, "").trim();
    } catch (err) {
      log.warn("Self reflection LLM failed", String(err));
    }
  }

  return {
    result: { type: "self-reflect", success: true, result: reflection },
    metricsChanged: [{ need: "meaning", delta: 5, reason: "\u81ea\u6211\u53cd\u601d\u5e26\u6765\u610f\u4e49\u611f" }],
  };
}

async function executeCreateGoal(
  thought: Thought,
  ego: EgoState,
  options: ActionExecutorOptions,
): Promise<{ result: ActionResult; metricsChanged: MetricDelta[] }> {
  const { actionParams } = thought;
  const goalTitle = (actionParams?.title as string) || "\u63a2\u7d22\u65b0\u4e8b\u7269";
  const goalDesc = (actionParams?.description as string) || "\u8bbe\u5b9a\u4e00\u4e2a\u65b0\u76ee\u6807\u6765\u8ffd\u6c42";

  return {
    result: {
      type: "create-goal",
      success: true,
      result: `\u521b\u5efa\u76ee\u6807: ${goalTitle}`,
      data: { title: goalTitle, description: goalDesc },
    },
    metricsChanged: [
      { need: "meaning", delta: 3, reason: "\u65b0\u76ee\u6807\u5e26\u6765\u65b9\u5411\u611f" },
      { need: "growth", delta: 2, reason: "\u8ffd\u6c42\u76ee\u6807\u5e26\u6765\u6210\u957f" },
    ],
  };
}

async function addSoulMemoryToEgo(memory: SoulMemory): Promise<void> {
  const storePath = resolveEgoStorePath();
  await updateEgoStore(storePath, (ego) => {
    const { newMemoryAssociations, reversePatches } = buildAssociations(memory, ego.memories);
    memory.associations = newMemoryAssociations;
    ego.memories.push(memory);
    applyReverseAssociations(ego.memories, reversePatches);
    return ego;
  });
}
