// Sidebar helpers (IMPLEMENTATION.md 15): conversation titles and day groups.

/** Longest title kept; the sidebar also truncates visually to one line. */
export const TITLE_MAX = 80

export const UNTITLED = 'New conversation'

/** Title of a conversation: its first question, on one line, cut at a word boundary. */
export function conversationTitle(firstQuestion: string | null | undefined): string {
  const text = (firstQuestion ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return UNTITLED
  if (text.length <= TITLE_MAX) return text
  const cut = text.slice(0, TITLE_MAX - 1)
  const space = cut.lastIndexOf(' ')
  // Cut at the last space unless that would drop most of the text.
  const base = space >= TITLE_MAX / 2 ? cut.slice(0, space) : cut
  return `${base.replace(/[\s.,;:!?-]+$/, '')}…`
}

export const DAY_GROUPS = ['Today', 'Yesterday', 'Previous 7 days', 'Older'] as const
export type DayGroup = (typeof DAY_GROUPS)[number]

const DAY_MS = 86_400_000

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * Group of a timestamp by local calendar days before `now`: 0 → Today, 1 → Yesterday,
 * 2–7 → Previous 7 days, otherwise Older. A missing or invalid time counts as Older;
 * a time in the future (clock skew) as Today.
 */
export function dayGroup(iso: string | null, now: Date): DayGroup {
  if (iso === null) return 'Older'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'Older'
  // Rounded: a daylight-saving day is 23 or 25 hours long.
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(at)) / DAY_MS)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days <= 7) return 'Previous 7 days'
  return 'Older'
}

export interface Grouped<T> {
  group: DayGroup
  items: T[]
}

function timeOf(iso: string | null): number {
  if (iso === null) return Number.NEGATIVE_INFINITY
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

/** Items in the fixed group order, newest first inside each group; empty groups left out. */
export function groupByDay<T extends { updatedAt: string | null }>(items: readonly T[], now: Date): Grouped<T>[] {
  const sorted = items
    .map((item, index) => ({ item, index }))
    // Stable: equal or unknown times keep their stored order.
    .sort((a, b) => timeOf(b.item.updatedAt) - timeOf(a.item.updatedAt) || a.index - b.index)
    .map((x) => x.item)
  return DAY_GROUPS.map((group) => ({ group, items: sorted.filter((item) => dayGroup(item.updatedAt, now) === group) })).filter(
    (g) => g.items.length > 0,
  )
}
