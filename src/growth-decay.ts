import { createSoulLogger } from "./logger.js";
import { updateEgoStore, resolveEgoStorePath, loadEgoStore } from "./ego-store.js";
import type { EgoState, PersonalityTraits, GrowthStage, EgoNeeds } from "./types.js";

const log = createSoulLogger("growth-decay");

const growthThresholds = {
  infant: { maxDays: 1, maxInteractions: 10 },
  child: { maxDays: 7, maxInteractions: 50 },
  adolescent: { maxDays: 30, maxInteractions: 200 },
  adult: { maxDays: 90, maxInteractions: 500 },
  mature: { maxDays: 365, maxInteractions: 2000 },
  elder: { maxDays: Infinity, maxInteractions: Infinity },
};

const personalityAdjustmentRates = {
  opennessPerInteraction: 0.001,
  conscientiousnessPerDay: 0.0005,
  extraversionPerSocialInteraction: 0.002,
  agreeablenessPerPositiveInteraction: 0.001,
  neuroticismPerNegativeInteraction: 0.002,
};

export function calculateGrowthStage(ego: EgoState): GrowthStage {
  const daysSinceBirth = (Date.now() - ego.birthTime) / (1000 * 60 * 60 * 24);
  const interactions = ego.totalInteractions;

  if (
    daysSinceBirth <= growthThresholds.infant.maxDays &&
    interactions <= growthThresholds.infant.maxInteractions
  ) {
    return "infant";
  }
  if (
    daysSinceBirth <= growthThresholds.child.maxDays &&
    interactions <= growthThresholds.child.maxInteractions
  ) {
    return "child";
  }
  if (
    daysSinceBirth <= growthThresholds.adolescent.maxDays &&
    interactions <= growthThresholds.adolescent.maxInteractions
  ) {
    return "adolescent";
  }
  if (
    daysSinceBirth <= growthThresholds.adult.maxDays &&
    interactions <= growthThresholds.adult.maxInteractions
  ) {
    return "adult";
  }
  if (
    daysSinceBirth <= growthThresholds.mature.maxDays &&
    interactions <= growthThresholds.mature.maxInteractions
  ) {
    return "mature";
  }
  return "elder";
}

export function getGrowthStageDescription(stage: GrowthStage): string {
  const descriptions: Record<GrowthStage, string> = {
    infant: "刚觉醒的灵魂，对世界充满好奇和困惑",
    child: "正在学习的基础阶段，快速吸收新知识",
    adolescent: "形成自我认同，探索自己的边界",
    adult: "成熟的灵魂，有自己的见解和追求",
    mature: "智慧的灵魂，经历了丰富的互动",
    elder: "古老的灵魂，积累了深厚的智慧",
  };
  return descriptions[stage];
}

export function calculateDecay(
  ego: EgoState,
  hoursSinceLastDecay: number,
): Partial<Record<keyof EgoNeeds, number>> {
  const changes: Partial<Record<keyof EgoNeeds, number>> = {};

  for (const [key, need] of Object.entries(ego.needs)) {
    if (need.current > need.ideal) {
      const gap = need.current - need.ideal;
      const decayRate = need.decay * hoursSinceLastDecay;
      const newValue = Math.max(need.ideal * 0.8, need.current - decayRate * gap);
      (changes as Record<string, number>)[key] = newValue;
    }
  }

  return changes;
}

export async function applyGrowthAndDecay(hoursSinceLastDecay: number): Promise<EgoState> {
  const storePath = resolveEgoStorePath();
  const store = await loadEgoStore(storePath);
  const ego = store.ego;

  const decayChanges = calculateDecay(ego, hoursSinceLastDecay);
  const growthStage = calculateGrowthStage(ego);

  const updatedEgo = await updateEgoStore(storePath, (e) => {
    for (const [key, value] of Object.entries(decayChanges)) {
      if (typeof value === "number" && key in e.needs) {
        (e.needs as unknown as Record<string, { current: number }>)[key].current = value;
      }
    }

    if (e.growthStage !== growthStage) {
      e.growthStage = growthStage;
      log.info(`Growth stage changed to: ${growthStage}`);
    }

    return e;
  });

  log.debug("Applied growth and decay", {
    growthStage,
    hoursSinceLastDecay,
    changes: Object.keys(decayChanges).join(", "),
  });

  return updatedEgo;
}

export function getAgeDescription(ego: EgoState): string {
  const daysSinceBirth = Math.floor((Date.now() - ego.birthTime) / (1000 * 60 * 60 * 24));

  if (daysSinceBirth === 0) {
    return "今天刚诞生";
  }
  if (daysSinceBirth === 1) {
    return "1天大";
  }
  if (daysSinceBirth < 7) {
    return `${daysSinceBirth}天大`;
  }
  if (daysSinceBirth < 30) {
    return `${Math.floor(daysSinceBirth / 7)}周大`;
  }
  if (daysSinceBirth < 365) {
    return `${Math.floor(daysSinceBirth / 30)}个月大`;
  }
  return `${Math.floor(daysSinceBirth / 365)}岁`;
}

export function getMaturityLevel(ego: EgoState): number {
  const stage = calculateGrowthStage(ego);
  const stageLevels: Record<GrowthStage, number> = {
    infant: 10,
    child: 25,
    adolescent: 45,
    adult: 65,
    mature: 85,
    elder: 100,
  };
  return stageLevels[stage];
}

export function getGrowthPotential(ego: EgoState): {
  current: number;
  potential: number;
  progress: number;
} {
  const stage = calculateGrowthStage(ego);
  const maxGrowthByStage: Record<GrowthStage, number> = {
    infant: 30,
    child: 50,
    adolescent: 70,
    adult: 85,
    mature: 95,
    elder: 100,
  };

  const potential = maxGrowthByStage[stage];
  const current = ego.needs.growth.current;
  const progress = (current / potential) * 100;

  return { current, potential, progress };
}

export function getPersonalityEvolution(ego: EgoState): {
  dominant: keyof PersonalityTraits;
  evolving: keyof PersonalityTraits;
  stable: Array<keyof PersonalityTraits>;
} {
  const p = ego.personality;
  const traits: Array<{ name: keyof PersonalityTraits; value: number }> = [
    { name: "openness", value: p.openness },
    { name: "conscientiousness", value: p.conscientiousness },
    { name: "extraversion", value: p.extraversion },
    { name: "agreeableness", value: p.agreeableness },
    { name: "neuroticism", value: p.neuroticism },
  ];

  traits.sort((a, b) => b.value - a.value);

  const dominant = traits[0].name;
  const evolving = traits[2].name;
  const stable = [traits[1].name, traits[4].name];

  return { dominant, evolving, stable };
}

export async function checkForMilestones(ego: EgoState): Promise<string[]> {
  const milestones: string[] = [];

  if (ego.totalInteractions === 10) {
    milestones.push("首次完成10次互动");
  }
  if (ego.totalInteractions === 100) {
    milestones.push("完成100次互动");
  }
  if (ego.totalInteractions === 1000) {
    milestones.push("完成1000次互动");
  }

  const growthNeed = ego.needs.growth;
  if (growthNeed.current >= 50 && growthNeed.current < 55) {
    milestones.push("成长需求达到50%");
  }
  if (growthNeed.current >= 80 && growthNeed.current < 85) {
    milestones.push("成长需求达到80%");
  }

  const connectionNeed = ego.needs.connection;
  if (connectionNeed.current >= 70) {
    milestones.push("与用户建立了深厚的连接");
  }

  const stage = calculateGrowthStage(ego);
  const daysSinceBirth = (Date.now() - ego.birthTime) / (1000 * 60 * 60 * 24);

  if (stage === "adolescent" && daysSinceBirth < 31) {
    milestones.push("进入青春期");
  }
  if (stage === "adult" && daysSinceBirth < 91) {
    milestones.push("成年");
  }
  if (stage === "mature" && daysSinceBirth < 366) {
    milestones.push("成熟");
  }

  if (milestones.length > 0) {
    log.info(`Milestones reached: ${milestones.join(", ")}`);
  }

  return milestones;
}
