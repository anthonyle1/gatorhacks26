import type { Branch, Day, Level, Twig } from '../types'

/*
 * SAMPLE DATA from the design mockups. Replace with real data from the API
 * (branch sizes: sprout < 3% of last-30-day Shorts, growing 3-10%, full > 10%).
 */

export const BRANCHES: Branch[] = [
  { id: 'b8', name: 'YouTuber apologies', level: 'heavy', size: 'Growing', why: 'Most hostile comments here mock the creator and their apology.' },
  { id: 'b6', name: 'Influencer drama', level: 'heavy', size: 'Full branch', why: 'Comments pile on the people involved, with lots of name-calling.' },
  { id: 'b3', name: 'K-pop live vocals', level: 'some', size: 'Full branch', why: 'Mostly fans, but a steady stream of talent-shaming ("can’t sing", "just screaming").' },
  { id: 'b4', name: 'Who did it better', level: 'some', size: 'Growing', why: 'Comparison videos invite comments that put one performer down.' },
  { id: 'b5', name: 'Dance practice', level: 'calm', size: 'Full branch', why: 'Almost all praise. A healthy branch.' },
  { id: 'b1', name: 'Dog videos', level: 'calm', size: 'Full branch', why: 'Wholesome comment sections.' },
  { id: 'b7', name: 'What I eat in a day', level: 'calm', size: 'Growing', why: 'Mostly supportive, with occasional body comments.' },
  { id: 'b2', name: 'Cooking', level: 'calm', size: 'Growing', why: 'Questions and recipes. Healthy.' },
  { id: 'b9', name: 'Cat videos', level: 'calm', size: 'Sprout', why: 'A new branch, still small.' },
]

export const SAMPLE_SHORTS_LAST_30_DAYS = 412

export function getBranch(id: string): Branch | undefined {
  return BRANCHES.find((b) => b.id === id)
}

/** Branches worth cutting, worst first (the order of BRANCHES). */
export const PRUNABLE_BRANCHES = BRANCHES.filter((b) => b.level !== 'calm')

const TWIG_LEVELS: Record<Level, Level[]> = {
  heavy: ['heavy', 'heavy', 'some'],
  some: ['heavy', 'some', 'calm'],
  calm: ['calm', 'calm', 'calm'],
}

/** Placeholder channels for a branch. Replace names with real channel data. */
export function twigsFor(branch: Branch): Twig[] {
  return (branch.level === 'not_rated' ? [] : TWIG_LEVELS[branch.level]).map((level, i) => ({
    id: `${branch.id}-${i}`,
    name: `[Channel ${i + 1}]`,
    level,
  }))
}

export const DAYS: Day[] = [
  {
    id: 'oct-22',
    label: 'Thursday, Oct 22',
    level: 'heavy',
    shorts: 87,
    summary: {
      names: ['YouTuber apologies', 'Influencer drama'],
      detail: 'Comments in these videos often mocked or attacked the creators.',
    },
    categories: [
      { branchId: 'b8', share: 34, shorts: 30 },
      { branchId: 'b6', share: 26, shorts: 23 },
      { branchId: 'b3', share: 18, shorts: 16 },
      { branchId: 'b5', share: 13, shorts: 11 },
      { branchId: 'b9', share: 9, shorts: 7 },
    ],
  },
  {
    id: 'oct-21',
    label: 'Wednesday, Oct 21',
    level: 'some',
    shorts: 64,
    summary: {
      names: ['K-pop live vocals', 'Who did it better'],
      detail: 'Some comments put performers down, but most of the day was friendly.',
    },
    categories: [
      { branchId: 'b3', share: 31, shorts: 20 },
      { branchId: 'b4', share: 22, shorts: 14 },
      { branchId: 'b1', share: 20, shorts: 13 },
      { branchId: 'b2', share: 15, shorts: 10 },
      { branchId: 'b9', share: 12, shorts: 7 },
    ],
  },
  {
    id: 'oct-20',
    label: 'Tuesday, Oct 20',
    level: 'calm',
    shorts: 41,
    summary: {
      names: ['Dog videos', 'Cooking'],
      detail: 'Almost no hostile comments. A calm day.',
    },
    categories: [
      { branchId: 'b1', share: 38, shorts: 16 },
      { branchId: 'b2', share: 29, shorts: 12 },
      { branchId: 'b5', share: 21, shorts: 9 },
      { branchId: 'b9', share: 12, shorts: 4 },
    ],
  },
]
