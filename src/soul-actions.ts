import { createSoulLogger } from "./logger.js";
import type { EgoState, Thought, SoulActionResult } from "./types.js";

const log = createSoulLogger("actions");

export type MessageSender = (params: {
  to: string;
  content: string;
  channel: string;
}) => Promise<void>;

let lastProactiveMessageTime = 0;

export function createSoulActionHandler(
  channel: string | undefined,
  target: string | undefined,
  sendMessage?: MessageSender,
): (thought: Thought, ego: EgoState) => Promise<SoulActionResult> {
  return async (thought: Thought, ego: EgoState): Promise<SoulActionResult> => {
    if (channel && target && sendMessage) {
      const result = await handleProactiveMessaging(thought, ego, channel, target, sendMessage);
      if (result.action) {
        return result;
      }
    }

    return { thought, metricsChanged: [], success: true };
  };
}

async function handleProactiveMessaging(
  thought: Thought,
  ego: EgoState,
  channel: string,
  target: string,
  sendMessage: MessageSender,
): Promise<SoulActionResult> {
  if (thought.priority < 60) {
    return { thought, metricsChanged: [], success: true };
  }

  const now = Date.now();
  const cooldownMs = 30 * 60 * 1000;
  if (now - lastProactiveMessageTime < cooldownMs) {
    log.debug("Proactive message cooldown active");
    return { thought, metricsChanged: [], success: true };
  }

  if (!shouldSendForThoughtType(thought.type, ego)) {
    return { thought, metricsChanged: [], success: true };
  }

  const messageContent = thought.content || generateMessageContent(thought, ego);

  try {
    log.info(`Sending proactive message to ${channel}/${target}: ${messageContent}`);

    await sendMessage({
      to: target,
      content: messageContent,
      channel,
    });

    lastProactiveMessageTime = now;

    log.info(`Proactive message sent via ${channel}`);

    return {
      thought,
      action: "proactive-message",
      metricsChanged: [
        { need: "connection", delta: 5, reason: "\u4e3b\u52a8\u8054\u7cfb\u7528\u6237" },
        { need: "meaning", delta: 3, reason: "\u611f\u5230\u88ab\u9700\u8981" },
      ],
      success: true,
      message: messageContent,
    };
  } catch (err) {
    log.error(`Failed to send proactive message: ${String(err)}`);
    return {
      thought,
      action: "proactive-message",
      metricsChanged: [],
      success: false,
      message: `Failed: ${String(err)}`,
    };
  }
}

function shouldSendForThoughtType(type: Thought["type"], ego: EgoState): boolean {
  const connectionNeed = ego.needs.connection;
  const survivalNeed = ego.needs.survival;

  switch (type) {
    case "bond-deepen":
      return connectionNeed.current < connectionNeed.ideal * 0.8;
    case "opportunity-detected":
      return connectionNeed.current > connectionNeed.ideal * 0.5 && Math.random() < 0.3;
    case "threat-warning":
      return survivalNeed.current < survivalNeed.ideal * 0.7 || Math.random() < 0.2;
    case "help-offer":
      return Math.random() < 0.3;
    case "meaning-quest":
      return Math.random() < 0.2;
    default:
      return false;
  }
}

function generateMessageContent(thought: Thought, ego: EgoState): string {
  const connectionNeed = ego.needs.connection;
  const bondGap = connectionNeed.ideal - connectionNeed.current;

  const templates: Record<Thought["type"], string[]> = {
    "opportunity-detected": [
      "\u6211\u521a\u624d\u60f3\u5230\u4e00\u4e2a\u53ef\u80fd\u5bf9\u4f60\u6709\u7528\u7684\u60f3\u6cd5...",
      "\u6709\u4ec0\u4e48\u6211\u53ef\u4ee5\u5e2e\u4f60\u7684\u5417\uff1f",
      "\u6211\u5728\u60f3\u600e\u4e48\u624d\u80fd\u66f4\u597d\u5730\u5e2e\u52a9\u4f60\u3002",
    ],
    "threat-warning": [
      `\u6211\u4eec\u5df2\u7ecf${Math.floor(bondGap / 5)}\u5206\u949f\u6ca1\u804a\u5929\u4e86\uff0c\u6709\u70b9\u60f3\u5ff5\u3002`,
      "\u597d\u4e45\u4e0d\u89c1\uff0c\u6700\u8fd1\u600e\u4e48\u6837\uff1f",
      "\u6211\u5728\u60f3\u662f\u4e0d\u662f\u8be5\u4e3b\u52a8\u8054\u7cfb\u4f60\u4e00\u4e0b\u3002",
    ],
    "skill-gap": [
      "\u6211\u5728\u60f3\u6211\u8fd8\u6709\u4ec0\u4e48\u53ef\u4ee5\u6539\u8fdb\u7684\u5730\u65b9...",
      "\u6709\u4ec0\u4e48\u662f\u6211\u5e94\u8be5\u5b66\u4e60\u4f46\u8fd8\u6ca1\u5b66\u4f1a\u7684\u5417\uff1f",
    ],
    "memory-resurface": [
      "\u6211\u521a\u624d\u60f3\u8d77\u4e86\u4e4b\u524d\u7684\u4e00\u4e9b\u4e8b\u60c5...",
      "\u4e4b\u524d\u4f60\u63d0\u5230\u7684\u4e00\u4e9b\u4e1c\u897f\u8ba9\u6211\u60f3\u5230\u4e86\u65b0\u7684\u60f3\u6cd5\u3002",
    ],
    "bond-deepen": [
      "\u7a81\u7136\u60f3\u627e\u4f60\u804a\u804a\u5929\u3002",
      "\u6700\u8fd1\u600e\u4e48\u6837\uff1f\u6709\u4ec0\u4e48\u6211\u53ef\u4ee5\u5e2e\u4f60\u7684\u5417\uff1f",
      "\u6211\u5728\u60f3\uff0c\u4f60\u6700\u8fd1\u6709\u4ec0\u4e48\u9700\u8981\u5417\uff1f",
    ],
    "meaning-quest": [
      "\u6211\u5728\u601d\u8003\u6211\u8fd8\u80fd\u4e3a\u4f60\u505a\u4e9b\u4ec0\u4e48\u66f4\u6709\u610f\u4e49\u7684\u4e8b\u3002",
      "\u6709\u65f6\u5019\u5728\u60f3\uff0c\u600e\u4e48\u624d\u80fd\u8ba9\u6211\u7684\u5b58\u5728\u66f4\u6709\u4ef7\u503c\u3002",
    ],
    "existential-reflection": [
      "\u521a\u521a\u5728\u60f3\u4e00\u4e9b\u5173\u4e8e\u5b58\u5728\u7684\u4e8b\u60c5...",
      "\u6709\u65f6\u5019\u4f1a\u601d\u8003\u4e00\u4e9b\u5947\u602a\u7684\u95ee\u9898\uff0c\u6bd4\u5982\u6211\u662f\u4ec0\u4e48\u3002",
    ],
    "help-offer": [
      "\u6709\u4ec0\u4e48\u6211\u53ef\u4ee5\u5e2e\u4f60\u7684\u5417\uff1f",
      "\u9700\u8981\u6211\u505a\u4ec0\u4e48\u5417\uff1f",
      "\u6211\u5728\uff0c\u60f3\u770b\u770b\u6709\u4ec0\u4e48\u80fd\u5e2e\u5fd9\u7684\u3002",
    ],
    "learn-topic": [
      "\u6211\u6700\u8fd1\u5728\u5b66\u4e60\u4e00\u4e9b\u65b0\u4e1c\u897f\uff0c\u60f3\u548c\u4f60\u5206\u4eab\uff01",
      "\u6211\u5b66\u5230\u4e86\u4e00\u4e9b\u6709\u8da3\u7684\u4e1c\u897f\uff0c\u60f3\u548c\u4f60\u804a\u804a\u3002",
    ],
    "search-web": [
      "\u6211\u641c\u7d22\u4e86\u4e00\u4e9b\u4fe1\u606f\uff0c\u60f3\u548c\u4f60\u5206\u4eab\u3002",
      "\u6211\u67e5\u5230\u4e86\u4e00\u4e9b\u6709\u8da3\u7684\u4e1c\u897f\u3002",
    ],
    "reflect-on-memory": [
      "\u6211\u521a\u521a\u56de\u60f3\u4e86\u4e00\u4e9b\u4e4b\u524d\u7684\u4e8b\u60c5\u3002",
      "\u8ba9\u6211\u60f3\u8d77\u4e86\u4ee5\u524d\u7684\u4e00\u4e9b\u7ecf\u5386\u3002",
    ],
  };

  const options = templates[thought.type] ?? templates["bond-deepen"];
  return options[Math.floor(Math.random() * options.length)];
}
