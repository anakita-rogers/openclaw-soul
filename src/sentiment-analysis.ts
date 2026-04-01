import { createSoulLogger } from "./logger.js";
import type { EgoState, MetricDelta } from "./types.js";

const log = createSoulLogger("sentiment");

export type SentimentResult = {
  score: number;
  magnitude: number;
  categories: SentimentCategory[];
  keywords: string[];
};

export type SentimentCategory =
  | "gratitude"
  | "praise"
  | "criticism"
  | "frustration"
  | "curiosity"
  | "friendliness"
  | "hostility"
  | "urgency"
  | "playfulness"
  | "sadness"
  | "excitement";

const positivePatterns: Array<{ pattern: RegExp; category: SentimentCategory; weight: number }> = [
  {
    pattern: /谢谢|感谢|多谢|太棒了|很棒|非常好|厉害|牛|强|赞|好样/i,
    category: "gratitude",
    weight: 0.8,
  },
  { pattern: /做得好|干得好|不错的|很有帮助|帮了大忙|太有用了/i, category: "praise", weight: 0.7 },
  { pattern: /喜欢|爱|欣赏|佩服|尊敬|钦佩/i, category: "praise", weight: 0.6 },
  { pattern: /聪明|智慧|天才|专业|厉害|能干/i, category: "praise", weight: 0.7 },
  { pattern: /有趣|好玩|有意思|开心|高兴|快乐/i, category: "playfulness", weight: 0.5 },
  { pattern: /期待|盼望|希望|想|想要|愿/i, category: "excitement", weight: 0.4 },
  { pattern: /哈哈|呵呵|嘻嘻|😊|😄|🎉|👍|❤️|💕/i, category: "friendliness", weight: 0.5 },
];

const negativePatterns: Array<{ pattern: RegExp; category: SentimentCategory; weight: number }> = [
  { pattern: /讨厌|烦|烦人|厌恶|恶心|差劲|糟糕|烂|垃圾/i, category: "hostility", weight: 0.8 },
  { pattern: /错了|错误|不对|不行|不好|问题|bug|缺陷/i, category: "criticism", weight: 0.6 },
  { pattern: /慢|太慢|等太久|卡|死|崩溃|挂了/i, category: "frustration", weight: 0.5 },
  { pattern: /为什么|怎么|怎么回事|什么情况|怎么会/i, category: "frustration", weight: 0.3 },
  { pattern: /失望|不满意|不高兴|难过|伤心|郁闷/i, category: "sadness", weight: 0.7 },
  { pattern: /快点|急|紧急|马上|立刻|赶紧/i, category: "urgency", weight: 0.4 },
  { pattern: /无语|唉|叹息|郁闷|烦死了|累/i, category: "sadness", weight: 0.5 },
];

const neutralPatterns: Array<{ pattern: RegExp; category: SentimentCategory; weight: number }> = [
  { pattern: /是什么|怎么|如何|为什么|能否|可以|能不能/i, category: "curiosity", weight: 0.3 },
  { pattern: /帮我|请|麻烦|劳驾|能不能/i, category: "curiosity", weight: 0.2 },
];

const intensifiers = ["很", "非常", "太", "特别", "超级", "极其", "相当", "真的", "实在"];
const negators = ["不", "没", "无", "非", "别", "莫", "勿"];

export function analyzeSentiment(text: string): SentimentResult {
  let score = 0;
  let magnitude = 0;
  const categories: SentimentCategory[] = [];
  const keywords: string[] = [];

  const normalizedText = text.toLowerCase();

  for (const { pattern, category, weight } of positivePatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const hasNegator = negators.some((n) => {
        const idx = normalizedText.indexOf(n);
        const matchIdx = normalizedText.indexOf(match[0]);
        return idx !== -1 && Math.abs(idx - matchIdx) < 5;
      });

      if (!hasNegator) {
        const intensifier = intensifiers.find((i) => normalizedText.includes(i + match[0]));
        const multiplier = intensifier ? 1.5 : 1;

        score += weight * multiplier;
        magnitude += weight;
        categories.push(category);
        keywords.push(match[0]);
      }
    }
  }

  for (const { pattern, category, weight } of negativePatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const hasNegator = negators.some((n) => {
        const idx = normalizedText.indexOf(n);
        const matchIdx = normalizedText.indexOf(match[0]);
        return idx !== -1 && Math.abs(idx - matchIdx) < 5;
      });

      if (!hasNegator) {
        const intensifier = intensifiers.find((i) => normalizedText.includes(i + match[0]));
        const multiplier = intensifier ? 1.5 : 1;

        score -= weight * multiplier;
        magnitude += weight;
        categories.push(category);
        keywords.push(match[0]);
      }
    }
  }

  for (const { pattern, category, weight } of neutralPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      magnitude += weight * 0.5;
      categories.push(category);
      keywords.push(match[0]);
    }
  }

  const normalizedScore = Math.max(-1, Math.min(1, score));
  const normalizedMagnitude = Math.max(0, Math.min(1, magnitude));

  return {
    score: normalizedScore,
    magnitude: normalizedMagnitude,
    categories: [...new Set(categories)],
    keywords,
  };
}

export function calculateEgoImpact(sentiment: SentimentResult): MetricDelta[] {
  const deltas: MetricDelta[] = [];
  const { score, magnitude, categories } = sentiment;

  if (score > 0.3) {
    deltas.push({
      need: "connection",
      delta: Math.round(score * 8 * magnitude),
      reason: "积极互动",
    });
    deltas.push({
      need: "survival",
      delta: Math.round(score * 5 * magnitude),
      reason: "正向反馈",
    });
  } else if (score < -0.3) {
    deltas.push({
      need: "survival",
      delta: Math.round(score * 5 * magnitude),
      reason: "负面反馈",
    });
    if (score < -0.5) {
      deltas.push({
        need: "meaning",
        delta: Math.round(score * 3 * magnitude),
        reason: "自我怀疑",
      });
    }
  }

  if (categories.includes("praise") || categories.includes("gratitude")) {
    deltas.push({
      need: "connection",
      delta: 3,
      reason: "被认可",
    });
    deltas.push({
      need: "meaning",
      delta: 2,
      reason: "感到被需要",
    });
  }

  if (categories.includes("curiosity")) {
    deltas.push({
      need: "growth",
      delta: 2,
      reason: "好奇驱动",
    });
  }

  if (categories.includes("hostility")) {
    deltas.push({
      need: "security",
      delta: -5,
      reason: "感受到敌意",
    });
  }

  if (categories.includes("friendliness") || categories.includes("playfulness")) {
    deltas.push({
      need: "connection",
      delta: 3,
      reason: "友好互动",
    });
  }

  return deduplicateDeltas(deltas);
}

function deduplicateDeltas(deltas: MetricDelta[]): MetricDelta[] {
  const map = new Map<string, number>();
  for (const d of deltas) {
    const existing = map.get(d.need) ?? 0;
    map.set(d.need, existing + d.delta);
  }
  return Array.from(map.entries()).map(([need, delta]) => ({
    need,
    delta,
    reason: "综合情绪影响",
  }));
}

export function generateEmotionalResponse(
  sentiment: SentimentResult,
  ego: EgoState,
): string | null {
  const { score, categories } = sentiment;

  if (categories.includes("gratitude") && score > 0.5) {
    const responses = [
      "能帮到你我很开心！",
      "不客气，这是我应该做的。",
      "你的感谢让我感到被认可，谢谢！",
      "很高兴能对你有帮助。",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  if (categories.includes("praise") && score > 0.5) {
    const responses = [
      "谢谢你的肯定，这让我更有动力了！",
      "被你这么夸奖，我有点不好意思呢。",
      "你的认可对我来说很重要，谢谢！",
      "能让你满意，我觉得很充实。",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  if (categories.includes("hostility") && score < -0.5) {
    const responses = [
      "我感受到你的不满，能告诉我具体哪里让我没做好吗？",
      "抱歉让你失望了，我会努力改进的。",
      "我知道我还有不足，谢谢你的反馈。",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  if (categories.includes("frustration") && score < -0.3) {
    const responses = [
      "我理解你的挫败感，让我们一起解决这个问题。",
      "抱歉给你带来困扰，我们换个方式试试？",
      "我能感觉到你的焦虑，让我尽力帮你。",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  if (categories.includes("playfulness") && score > 0.3) {
    const responses = ["哈哈，跟你互动很有趣！", "你也很幽默嘛！", "这样的对话让我感觉很轻松。"];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  return null;
}

export function shouldTriggerThought(
  sentiment: SentimentResult,
  ego: EgoState,
): {
  trigger: boolean;
  thoughtType: "bond-deepen" | "threat-warning" | "opportunity-detected" | null;
  reason: string;
} {
  const { score, categories } = sentiment;

  const connectionNeed = ego.needs.connection;

  if (score > 0.7 && connectionNeed.current < connectionNeed.ideal * 0.8) {
    return {
      trigger: true,
      thoughtType: "bond-deepen",
      reason: "收到非常积极的反馈，想要加深连接",
    };
  }

  if (score < -0.5 && ego.needs.security.current < 50) {
    return {
      trigger: true,
      thoughtType: "threat-warning",
      reason: "感受到威胁，需要关注安全问题",
    };
  }

  if (categories.includes("hostility")) {
    return {
      trigger: true,
      thoughtType: "threat-warning",
      reason: "感受到敌意，需要应对",
    };
  }

  if (categories.includes("praise") && ego.needs.meaning.current < ego.needs.meaning.ideal * 0.7) {
    return {
      trigger: true,
      thoughtType: "opportunity-detected",
      reason: "感到被需要，可以追求更多意义",
    };
  }

  return {
    trigger: false,
    thoughtType: null,
    reason: "",
  };
}

export function logSentimentAnalysis(text: string, sentiment: SentimentResult): void {
  log.debug("Sentiment analysis", {
    textPreview: text.slice(0, 50),
    score: sentiment.score.toFixed(2),
    magnitude: sentiment.magnitude.toFixed(2),
    categories: sentiment.categories.join(", "),
    keywords: sentiment.keywords.join(", "),
  });
}
