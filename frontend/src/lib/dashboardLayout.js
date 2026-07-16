// Fixed-width layout for dashboard tabs. Every card is a constant BASE_WIDTH wide
// (multiplied by the item's `width` unit) and rows simply wrap; the area scrolls
// horizontally if a card is wider than the viewport. An item's `width` is a unit
// count (1..4), so a width-2 card lines up with two stacked width-1 cards. The
// card height is always CARD_HEIGHT so tall and short charts finish on the same
// bottom edge.

export const BASE_WIDTH = 450 // px — one width unit
export const CARD_GAP = 16 // px — matches the flex `gap-4`
export const CARD_HEIGHT = 320 // px — constant chart area height

export const WIDTH_CHOICES = [1, 2, 3, 4]
export const DEFAULT_WIDTH = 1

// Legacy items stored width as 'half' / 'full'; new items store a unit number.
export const normalizeWidth = (value) => {
  if (value === 'full') return 2
  if (value === 'half') return 1
  const n = Number(value)
  return WIDTH_CHOICES.includes(n) ? n : DEFAULT_WIDTH
}

// Pixel width for an item spanning `n` units, including the gaps it swallows so
// an n-wide card aligns with n single cards laid side by side.
export const itemWidthPx = (value) => {
  const n = normalizeWidth(value)
  return n * BASE_WIDTH + (n - 1) * CARD_GAP
}
