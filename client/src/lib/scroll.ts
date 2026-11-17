// Thread auto-scroll (IMPLEMENTATION.md 15): follow the stream while the reader is at the
// bottom; once they scroll up, stop following and offer "Jump to latest".

export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** Distance from the bottom (px) that still counts as "at the bottom". */
export const NEAR_BOTTOM_PX = 80

export function isNearBottom(m: ScrollMetrics, threshold: number = NEAR_BOTTOM_PX): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= threshold
}
