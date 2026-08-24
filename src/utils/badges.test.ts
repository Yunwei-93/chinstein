import { describe, it, expect } from 'vitest'
import { getEarnedBadges, getNewBadges } from './badges'
import type { User } from '../types'

// base user for tests; each case overrides only the fields it cares about
function makeUser(overrides: Partial<User> = {}): User {
  return {
    name: 'Test',
    level: 'Beginner',
    points: 0,
    streak: 0,
    badges: [],
    learnedCharacterIds: [],
    lastStudiedDate: null,
    todayReward: 20,
    lastSession: null,
    ...overrides,
  }
}

describe('getEarnedBadges', () => {
  it('brand new user has no badges', () => {
    expect(getEarnedBadges(makeUser())).toEqual([])
  })

  it('unlocks First Character after learning one', () => {
    const user = makeUser({ learnedCharacterIds: [1] })
    expect(getEarnedBadges(user)).toContain('First Character')
  })

  it('does not unlock 10 Characters at 9', () => {
    const user = makeUser({ learnedCharacterIds: [1,2,3,4,5,6,7,8,9] })
    expect(getEarnedBadges(user)).not.toContain('10 Characters')
  })

  it('unlocks 10 Characters exactly at 10 (boundary)', () => {
    const user = makeUser({ learnedCharacterIds: [1,2,3,4,5,6,7,8,9,10] })
    expect(getEarnedBadges(user)).toContain('10 Characters')
  })

  it('unlocks both streak badges at 7 days', () => {
    const user = makeUser({ streak: 7 })
    const badges = getEarnedBadges(user)
    expect(badges).toContain('3 Day Streak')
    expect(badges).toContain('7 Day Streak')
  })

  it('unlocks 600 Points Club exactly at 600 (boundary)', () => {
    expect(getEarnedBadges(makeUser({ points: 599 }))).not.toContain('600 Points Club')
    expect(getEarnedBadges(makeUser({ points: 600 }))).toContain('600 Points Club')
  })

  it('is a pure function - does not mutate the user', () => {
    const user = makeUser({ points: 700, badges: ['stale'] })
    const snapshot = JSON.stringify(user)
    getEarnedBadges(user)
    expect(JSON.stringify(user)).toBe(snapshot)
  })
})

describe('getNewBadges', () => {
  it('returns only the newly unlocked ones', () => {
    const before = ['600 Points Club']
    const after = ['600 Points Club', 'First Character']
    expect(getNewBadges(before, after)).toEqual(['First Character'])
  })

  it('returns empty when nothing changed', () => {
    const same = ['600 Points Club']
    expect(getNewBadges(same, same)).toEqual([])
  })

  it('returns empty when before is a superset (badges are never removed in practice)', () => {
    expect(getNewBadges(['a', 'b'], ['a'])).toEqual([])
  })
})