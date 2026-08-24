import type { User } from '../types'

// each rule = a badge name + a predicate
interface BadgeRule {
  name: string
  isEarned: (user: User) => boolean
}

// adding a badge = adding one entry here; the functions below never change
const badgeRules: BadgeRule[] = [
  { name: 'First Character',  isEarned: u => u.learnedCharacterIds.length >= 1 },
  { name: '10 Characters',    isEarned: u => u.learnedCharacterIds.length >= 10 },
  { name: '3 Day Streak',     isEarned: u => u.streak >= 3 },
  { name: '7 Day Streak',     isEarned: u => u.streak >= 7 },
  { name: '600 Points Club',  isEarned: u => u.points >= 600 },
  { name: '1000 Points Club', isEarned: u => u.points >= 1000 },
]


// pure function: given a user, derive the full list of badges they've earned
export function getEarnedBadges(user: User): string[] {
  return badgeRules
    .filter(rule => rule.isEarned(user))
    .map(rule => rule.name)
}


// diff two badge lists to find what was just unlocked
export function getNewBadges(before: string[], after: string[]): string[] {
  return after.filter(badge => !before.includes(badge))
}