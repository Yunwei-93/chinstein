// format a Date as "YYYY-MM-DD" using the user's local timezone
function getDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')  // months are 0-indexed
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getTodayKey(): string {
  return getDateKey(new Date())
}

function getYesterdayKey(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)   // rolls over month & year automatically
  return getDateKey(d)
}

export function calculateStreak(
  currentStreak: number,
  lastStudiedDate: string | null
): number {
  if (lastStudiedDate === getTodayKey()) return currentStreak      // already studied today
  if (lastStudiedDate === getYesterdayKey()) return currentStreak + 1  //  consecutive
  return 1                                                          // first time or streak broken
}