// the rules only need these three stats
interface BadgeStats {
  points: number
  streak: number
  learnedCharacterIds: number[]
}

interface BadgeRule {
  name: string
  isEarned: (s: BadgeStats) => boolean
}

const badgeRules: BadgeRule[] = [
  { name: 'First Character',  isEarned: s => s.learnedCharacterIds.length >= 1 },
  { name: '10 Characters',    isEarned: s => s.learnedCharacterIds.length >= 10 },
  { name: '3 Day Streak',     isEarned: s => s.streak >= 3 },
  { name: '7 Day Streak',     isEarned: s => s.streak >= 7 },
  { name: '600 Points Club',  isEarned: s => s.points >= 600 },
  { name: '1000 Points Club', isEarned: s => s.points >= 1000 },
]


export function getEarnedBadges(stats: BadgeStats): string[] {
  return badgeRules.filter(r => r.isEarned(stats)).map(r => r.name)
}

export function getNewBadges(before: string[], after: string[]): string[] {
  return after.filter(b => !before.includes(b))
}