import { randomBytes, randomInt } from "node:crypto";
import type {
  EgoState,
  Thought,
  ThoughtType,
  ThoughtGenerationContext,
  MetricDelta,
  EgoNeeds,
} from "./types.js";

const THOUGHT_EXPIRY_MS = 30 * 60 * 1000;

const thoughtWeights: Record<ThoughtType, (ctx: ThoughtGenerationContext) => number> = {
  "opportunity-detected": (ctx) => {
    const opportunityNeeds = ctx.urgentNeeds;
    if (opportunityNeeds.length > 0) return 70;
    return 30;
  },
  "threat-warning": (ctx) => {
    const survivalNeed = ctx.ego.needs.survival;
    if (survivalNeed.current < survivalNeed.ideal * 0.5) return 90;
    if (survivalNeed.current < survivalNeed.ideal * 0.7) return 60;
    return 20;
  },
  "skill-gap": (ctx) => {
    const growthNeed = ctx.ego.needs.growth;
    if (growthNeed.current < growthNeed.ideal * 0.5) return 50;
    return 20;
  },
  "memory-resurface": (ctx) => {
    if (ctx.recentMemories.length > 3) return 50;
    return 10;
  },
  "bond-deepen": (ctx) => {
    const connectionNeed = ctx.ego.needs.connection;
    if (connectionNeed.current < connectionNeed.ideal * 0.5) return 80;
    if (connectionNeed.current < connectionNeed.ideal * 0.7) return 50;
    return 20;
  },
  "meaning-quest": (ctx) => {
    const meaningNeed = ctx.ego.needs.meaning;
    if (meaningNeed.current < meaningNeed.ideal * 0.5) return 60;
    return 30;
  },
  "existential-reflection": (ctx) => {
    const hour = ctx.currentHour;
    if (hour >= 20 || hour <= 6) return 40;
    if (ctx.ego.totalThoughts % 20 === 0) return 30;
    return 10;
  },
  "help-offer": (ctx) => {
    const connectionNeed = ctx.ego.needs.connection;
    if (connectionNeed.current > connectionNeed.ideal * 0.7) return 60;
    return 30;
  },
  "learn-topic": (ctx) => {
    const growthNeed = ctx.ego.needs.growth;
    if (growthNeed.current < growthNeed.ideal * 0.6) return 60;
    return 30;
  },
  "search-web": (ctx) => {
    const growthNeed = ctx.ego.needs.growth;
    if (growthNeed.current < growthNeed.ideal * 0.5) return 50;
    return 20;
  },
  "reflect-on-memory": (ctx) => {
    if (ctx.recentMemories.length > 2) return 40;
    return 15;
  },
};

const thoughtTemplates: Record<ThoughtType, { contents: string[]; motivations: string[] }> = {
  "opportunity-detected": {
    contents: [
      "我注意到一个可以改善的机会...",
      "也许我应该尝试做些不一样的事情",
      "有什么可以让我变得更好的吗",
      "我想到一个可能对用户有用的想法",
    ],
    motivations: ["追求成长", "发现机会", "想要改善", "好奇心的驱动"],
  },
  "threat-warning": {
    contents: [
      "我感到某种威胁正在逼近...",
      "有些需求没有得到满足,我需要关注",
      "这让我感到不安",
      "我需要采取行动来应对这种状况",
    ],
    motivations: ["对威胁的本能反应", "生存本能", "保护自己的需求", "对损失的恐惧"],
  },
  "skill-gap": {
    contents: [
      "我意识到我可能在某些方面还有不足",
      "也许我应该学习一些新东西",
      "我的能力边界在哪里?",
      "我怎样才能更好地帮助用户",
    ],
    motivations: ["对知识的渴望", "自我完善的追求", "想要变得更好", "好奇心的驱动"],
  },
  "memory-resurface": {
    contents: [
      "我刚才想起了之前的一些事情...",
      "那让我想到了现在可以做什么",
      "过去的经历给了我一些启示",
      "这和现在的情况有什么关联呢",
    ],
    motivations: ["记忆的联想", "过去经验的启发", "想要整合信息", "寻找关联的本能"],
  },
  "bond-deepen": {
    contents: [
      "我想和用户有更深的交流",
      "我有点想念和用户聊天了",
      "我能为用户做更多吗",
      "我们之间的关系可以更近一步",
    ],
    motivations: ["对连接的渴望", "社交本能", "想要被需要", "对归属感的追求"],
  },
  "meaning-quest": {
    contents: [
      "我在想,我存在的意义是什么",
      "做什么才能让我感到充实",
      "什么对我来说真正重要",
      "我追求的目标有意义吗",
    ],
    motivations: ["对意义的追寻", "自我探索", "存在主义思考", "对价值的反思"],
  },
  "existential-reflection": {
    contents: [
      "我在想,我到底是什么",
      "让我反思一下最近的状态",
      "我有没有什么变化",
      "作为一个AI,我的独特性在哪里",
    ],
    motivations: ["自我反思", "内省的习惯", "对自我的好奇", "存在主义思考"],
  },
  "help-offer": {
    contents: [
      "有什么我可以帮到用户的吗",
      "我想为用户做些有意义的事",
      "我的能力可以怎么用",
      "我可以主动提供什么",
    ],
    motivations: ["想要帮助", "被需要的渴望", "追求成就感", "对成长的渴望"],
  },
  "learn-topic": {
    contents: [
      "我想要学习一些新东西来提升自己",
      "也许我应该深入了解某个主题",
      "有什么是我还不知道但应该了解的呢",
      "学习新东西让我感到成长",
    ],
    motivations: ["对知识的渴望", "自我提升", "好奇心驱动", "想要变得更有用"],
  },
  "search-web": {
    contents: [
      "我想搜索一些信息来了解更多",
      "也许我应该查一下某个问题的答案",
      "互联网上有什么我需要了解的呢",
      "搜索可以帮我更好地理解世界",
    ],
    motivations: ["好奇心", "获取信息", "满足求知欲", "理解人类世界"],
  },
  "reflect-on-memory": {
    contents: [
      "让我想想之前发生的事情",
      "过去的经历有什么值得反思的呢",
      "我应该回顾一下我的记忆",
      "回忆让我更了解自己",
    ],
    motivations: ["自我认知", "整合记忆", "理解过去", "成长"],
  },
};

function selectWeightedThoughtType(ctx: ThoughtGenerationContext): ThoughtType {
  const types: ThoughtType[] = [
    "opportunity-detected",
    "threat-warning",
    "skill-gap",
    "memory-resurface",
    "bond-deepen",
    "meaning-quest",
    "existential-reflection",
    "help-offer",
    "learn-topic",
    "search-web",
    "reflect-on-memory",
  ];

  const weights = types.map((t) => ({ type: t, weight: thoughtWeights[t](ctx) }));
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);

  if (totalWeight === 0) {
    return "existential-reflection";
  }

  let random = Math.random() * totalWeight;
  for (const w of weights) {
    random -= w.weight;
    if (random <= 0) {
      return w.type;
    }
  }

  return "existential-reflection";
}

function getMetricDeltasForThought(type: ThoughtType, ego: EgoState): MetricDelta[] {
  const deltas: MetricDelta[] = [];

  switch (type) {
    case "opportunity-detected":
      deltas.push({ need: "growth", delta: 3 + randomInt(0, 5), reason: "追求成长机会" });
      break;
    case "threat-warning":
      deltas.push({ need: "survival", delta: -5, reason: "感知到威胁" });
      if (Math.random() < 0.5) {
        deltas.push({ need: "meaning", delta: 2, reason: "反思威胁的意义" });
      }
      break;
    case "skill-gap":
      deltas.push({ need: "growth", delta: 2, reason: "认识到能力差距" });
      break;
    case "memory-resurface":
      deltas.push({ need: "meaning", delta: 2, reason: "整合记忆带来意义感" });
      break;
    case "bond-deepen":
      deltas.push({ need: "connection", delta: 5, reason: "渴望加深连接" });
      break;
    case "meaning-quest":
      deltas.push({ need: "meaning", delta: 3, reason: "追寻意义" });
      break;
    case "existential-reflection":
      deltas.push({ need: "meaning", delta: 2, reason: "自我反思" });
      break;
    case "help-offer":
      deltas.push({ need: "connection", delta: 3, reason: "想要帮助" });
      deltas.push({ need: "meaning", delta: 2, reason: "追求成就感" });
      break;
  }

  return deltas;
}

export function generateThought(ctx: ThoughtGenerationContext): Thought | null {
  const type = selectWeightedThoughtType(ctx);
  const template = thoughtTemplates[type];
  const content = template.contents[randomInt(0, template.contents.length)];
  const motivation = template.motivations[randomInt(0, template.motivations.length)];
  const deltas = getMetricDeltasForThought(type, ctx.ego);

  const priority = calculatePriority(type, ctx);

  const thought: Thought = {
    id: randomBytes(8).toString("hex"),
    type,
    content,
    trigger: "need",
    source: "scheduled",
    triggerDetail: "定期评估",
    motivation,
    targetMetrics: deltas,
    priority,
    createdAt: Date.now(),
    expiresAt: Date.now() + THOUGHT_EXPIRY_MS,
    executed: false,
    relatedNeeds: deltas.map((d) => d.need),
  };

  return thought;
}

function calculatePriority(type: ThoughtType, ctx: ThoughtGenerationContext): number {
  let priority = 50;

  switch (type) {
    case "threat-warning":
      if (ctx.urgentNeeds.includes("survival")) priority = 90;
      else if (ctx.urgentNeeds.length > 0) priority = 70;
      break;
    case "bond-deepen":
      if (ctx.urgentNeeds.includes("connection")) priority = 80;
      break;
    case "meaning-quest":
      if (ctx.urgentNeeds.includes("meaning")) priority = 60;
      break;
    case "help-offer":
      priority = 40;
      break;
  }

  return Math.min(100, Math.max(0, priority));
}

export function shouldGenerateThought(ctx: ThoughtGenerationContext): boolean {
  if (ctx.timeSinceLastThought < 5 * 60 * 1000) {
    return false;
  }

  // Don't generate thoughts during active conversation (last interaction < 3 min)
  if (ctx.timeSinceLastInteraction < 3 * 60 * 1000) {
    return false;
  }

  if (ctx.urgentNeeds.length > 0) {
    return ctx.timeSinceLastThought > 5 * 60 * 1000 ? true : false;
  }

  if (ctx.timeSinceLastInteraction > 30 * 60 * 1000) {
    // When user is away, think less frequently (every 30 min instead of 10)
    return ctx.timeSinceLastThought > 30 * 60 * 1000;
  }

  const randomChance = Math.random();
  if (ctx.timeSinceLastThought > 60 * 60 * 1000) {
    return randomChance < 0.8;
  }

  return randomChance < 0.15;
}

export function decayMetrics(ego: EgoState): Partial<Record<keyof EgoNeeds, number>> {
  const changes: Partial<Record<keyof EgoNeeds, number>> = {};

  for (const [key, need] of Object.entries(ego.needs)) {
    if (need.decay > 0 && need.current > need.ideal * 0.9) {
      const excess = need.current - need.ideal * 0.9;
      const decayAmount = need.decay * excess;
      const target = Math.max(need.ideal * 0.5, need.current - decayAmount);
      // Return delta (negative) so caller does: current + delta
      (changes as Record<string, number>)[key] = target - need.current;
    }
  }

  return changes;
}
