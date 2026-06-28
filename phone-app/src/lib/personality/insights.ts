export const DNA_THRESHOLDS = {
  formality: { low: 0.3, high: 0.7 },
  emoji: { low: 0.3, high: 0.6 },
  humor: { low: 0.3, high: 0.6 },
  maxWords: 300,
};

export interface Topic {
  topic: string;
  count: number;
}

export interface UserProfile {
  preferredLength: number;
  emojiUsage: number;
  formality: number;
  humorLevel: number;
  topTopics?: Topic[];
  totalInteractions: number;
}

export function generateInsights(profile: UserProfile): string[] {
  const insights: string[] = [];
  if (profile.preferredLength < 50) insights.push("You prefer shorter, direct responses");
  else insights.push("You prefer detailed, comprehensive responses");

  if (profile.emojiUsage > DNA_THRESHOLDS.emoji.high) insights.push("You use emojis frequently in your messages");
  else if (profile.emojiUsage < DNA_THRESHOLDS.emoji.low) insights.push("You rarely use emojis in conversation");

  if (profile.topTopics && profile.topTopics.length > 0) {
    const top = profile.topTopics[0];
    insights.push(`${top.topic} is your top topic — ${top.count} conversations`);
  }

  return insights.length ? insights : ["Your communication style is still evolving."];
}
