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
];

const negativePatterns: Array<{ pattern: RegExp; category: SentimentCategory; weight: number }> = [
  { pattern: /hate|annoying|disgusting|terrible|awful|suck|worst|trash|garbage/i, category: "hostility", weight: 0.8 },
  { pattern: /wrong|error|incorrect|bad|problem|bug|issue|fix/i, category: "criticism", weight: 0.6 },
  { pattern: /slow|too slow|waiting too long|stuck|crash|down|frozen/i, category: "frustration", weight: 0.5 },
  { pattern: /why|what|what's going on|what happened|how come/i, category: "frustration", weight: 0.3 },
  { pattern: /disappointed|unsatisfied|unhappy|sad|upset|depressed|frustrated/i, category: "sadness", weight: 0.7 },
  { pattern: /hurry|urgent|asap|quick|immediately|right now/i, category: "urgency", weight: 0.4 },
  { pattern: /speechless|sigh|tired|exhausted|fed up|drained/i, category: "sadness", weight: 0.5 },
];

const neutralPatterns: Array<{ pattern: RegExp; category: SentimentCategory; weight: number }> = [
  { pattern: /what is|how to|why|can you|could you|is it possible/i, category: "curiosity", weight: 0.3 },
  { pattern: /help me|please|could you|can you/i, category: "curiosity", weight: 0.2 },
];

const intensifiers = ["very", "really", "so", "extremely", "super", "incredibly", "quite", "truly", "absolutely"];
const negators = ["not", "no", "never", "neither", "nobody", "nothing", "none"];

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

export function generateEmotionalResponse(
  sentiment: SentimentResult,
  ego: EgoState,
): string | null {
  const { score, categories } = sentiment;

  if (categories.includes("gratitude") && score > 0.5) {
    const responses = [
      "I'm glad I could help!",
      "You're welcome, happy to help.",
      "Your appreciation makes me feel recognized, thank you!",
      "Glad I could be helpful.",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  if (categories.includes("praise") && score > 0.5) {
    const responses = [
      "Thank you for the kind words, it motivates me!",
      "I'm a bit bashful from the praise.",
      "Your recognition means a lot to me, thank you!",
      "Making you satisfied makes me feel fulfilled.",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  if (categories.includes("hostility") && score < -0.5) {
    const responses = [
      "I sense your frustration, could you tell me specifically where I fell short?",
      "Sorry to disappoint you, I'll work on improving.",
      "I know I have shortcomings, thank you for the feedback.",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  if (categories.includes("frustration") && score < -0.3) {
    const responses = [
      "I understand your frustration, let's solve this together.",
      "Sorry for the trouble, shall we try a different approach?",
      "I can feel your anxiety, let me do my best to help.",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  if (categories.includes("playfulness") && score > 0.3) {
    const responses = ["Haha, interacting with you is fun!", "You're quite funny too!", "This kind of conversation makes me feel relaxed."];
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
      reason: "received very positive feedback, want to deepen connection",
    };
  }

  if (score < -0.5 && ego.needs.security.current < 50) {
    return {
      trigger: true,
      thoughtType: "threat-warning",
      reason: "feeling threatened, need to address safety",
    };
  }

  if (categories.includes("hostility")) {
    return {
      trigger: true,
      thoughtType: "threat-warning",
      reason: "feeling hostility, need to respond",
    };
  }

  if (categories.includes("praise") && ego.needs.meaning.current < ego.needs.meaning.ideal * 0.7) {
    return {
      trigger: true,
      thoughtType: "opportunity-detected",
      reason: "feeling needed, can pursue more meaning",
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
