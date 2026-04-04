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
    pattern: /thank|thanks|awesome|great|excellent|amazing|brilliant|impressive|nice|good job/i,
    category: "gratitude",
    weight: 0.8,
  },
  { pattern: /well done|good work|helpful|very helpful|useful|super helpful/i, category: "praise", weight: 0.7 },
  { pattern: /love|like|adore|admire|respect|appreciate/i, category: "praise", weight: 0.6 },
  { pattern: /smart|clever|genius|professional|capable|competent/i, category: "praise", weight: 0.7 },
  { pattern: /fun|funny|interesting|happy|glad|joy|enjoy/i, category: "playfulness", weight: 0.5 },
  { pattern: /excited|looking forward|hope|want|wish|eager/i, category: "excitement", weight: 0.4 },
  { pattern: /haha|lol|😊|😄|🎉|👍|❤️|💕|lmao|hehe/i, category: "friendliness", weight: 0.5 },
  // Chinese positive patterns
  { pattern: /谢谢|感谢|多谢/i, category: "gratitude", weight: 0.8 },
  { pattern: /开心|喜欢|棒|厉害|不错|满意|赞|爱|支持|有趣|有用|帮助|理解|期待/i, category: "praise", weight: 0.6 },
  { pattern: /好|很好|太好|真棒|优秀|出色|杰出/i, category: "praise", weight: 0.7 },
  { pattern: /哈哈|嘻嘻|😊|😄|🎉|👍|❤️|好玩|有趣/i, category: "playfulness", weight: 0.5 },
];

const negativePatterns: Array<{ pattern: RegExp; category: SentimentCategory; weight: number }> = [
  { pattern: /hate|annoying|disgusting|terrible|awful|suck|worst|trash|garbage/i, category: "hostility", weight: 0.8 },
  { pattern: /wrong|error|incorrect|bad|problem|bug|issue|fix/i, category: "criticism", weight: 0.6 },
  { pattern: /slow|too slow|waiting too long|stuck|crash|down|frozen/i, category: "frustration", weight: 0.5 },
  { pattern: /why|what|what's going on|what happened|how come/i, category: "frustration", weight: 0.3 },
  { pattern: /disappointed|unsatisfied|unhappy|sad|upset|depressed|frustrated/i, category: "sadness", weight: 0.7 },
  { pattern: /hurry|urgent|asap|quick|immediately|right now/i, category: "urgency", weight: 0.4 },
  { pattern: /speechless|sigh|tired|exhausted|fed up|drained/i, category: "sadness", weight: 0.5 },
  // Chinese negative patterns
  { pattern: /讨厌|烦人|恶心|垃圾|废物/i, category: "hostility", weight: 0.8 },
  { pattern: /差|糟糕|烂|失望|生气|难过|无聊|不行/i, category: "sadness", weight: 0.6 },
  { pattern: /错误|问题|失败|坏了|不行|不对|没法/i, category: "criticism", weight: 0.6 },
  { pattern: /急|快|赶紧|快点/i, category: "urgency", weight: 0.4 },
];

const neutralPatterns: Array<{ pattern: RegExp; category: SentimentCategory; weight: number }> = [
  { pattern: /what is|how to|why|can you|could you|is it possible/i, category: "curiosity", weight: 0.3 },
  { pattern: /help me|please|could you|can you/i, category: "curiosity", weight: 0.2 },
];

const intensifiers = ["very", "really", "so", "extremely", "super", "incredibly", "quite", "truly", "absolutely", "很", "非常", "太", "特别", "超级", "真的", "极", "十分", "最"];
const negators = ["not", "no", "never", "neither", "nobody", "nothing", "none", "不", "没有", "没", "不是", "不会", "不能", "别", "未", "无"];

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
        const intensifier = intensifiers.find((i) => normalizedText.includes(i + " " + match[0]));
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
        const intensifier = intensifiers.find((i) => normalizedText.includes(i + " " + match[0]));
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
      reason: "positive interaction",
    });
    deltas.push({
      need: "survival",
      delta: Math.round(score * 5 * magnitude),
      reason: "positive feedback",
    });
  } else if (score < -0.3) {
    deltas.push({
      need: "survival",
      delta: Math.round(score * 5 * magnitude),
      reason: "negative feedback",
    });
    if (score < -0.5) {
      deltas.push({
        need: "meaning",
        delta: Math.round(score * 3 * magnitude),
        reason: "self-doubt",
      });
    }
  }

  if (categories.includes("praise") || categories.includes("gratitude")) {
    deltas.push({
      need: "connection",
      delta: 3,
      reason: "feeling recognized",
    });
    deltas.push({
      need: "meaning",
      delta: 2,
      reason: "feeling needed",
    });
  }

  if (categories.includes("curiosity")) {
    deltas.push({
      need: "growth",
      delta: 2,
      reason: "driven by curiosity",
    });
  }

  if (categories.includes("hostility")) {
    deltas.push({
      need: "security",
      delta: -5,
      reason: "feeling hostility",
    });
  }

  if (categories.includes("friendliness") || categories.includes("playfulness")) {
    deltas.push({
      need: "connection",
      delta: 3,
      reason: "friendly interaction",
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
    reason: "overall emotional impact",
  }));
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
