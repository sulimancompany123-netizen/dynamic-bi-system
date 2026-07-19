

export const BASE_WIDTH = 450 // px — the reference width of one unit (the design size)
export const CARD_GAP = 16 // px — matches the flex `gap-4`
export const CARD_HEIGHT = 300 // px — the chart area height at BASE_WIDTH
export const MIN_UNIT_WIDTH = 300 // px — below this, cards stop shrinking and the row scrolls

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
export const itemWidthPx = (value, unitWidth = BASE_WIDTH) => {
  const n = normalizeWidth(value)
  return n * unitWidth + (n - 1) * CARD_GAP
}

// One unit's width for a container of `containerWidth` px: shrink the units so a
// full ROW_UNITS row fits the screen exactly at 100% zoom, but never grow past the
// design width and never shrink below MIN_UNIT_WIDTH (past that the row scrolls).
export const unitWidthFor = (containerWidth) => {
  if (!containerWidth) return BASE_WIDTH
  const fitted = Math.floor((containerWidth - (ROW_UNITS - 1) * CARD_GAP) / ROW_UNITS)
  return Math.max(MIN_UNIT_WIDTH, Math.min(BASE_WIDTH, fitted))
}

// Keep the card's proportions as the units shrink, so a narrower screen just scales
// the whole design down instead of leaving tall, half-empty cards.
export const cardHeightFor = (unitWidth) => Math.round(CARD_HEIGHT * (unitWidth / BASE_WIDTH))

// Every row holds exactly this many width units, whatever the viewport size —
// three width-1 cards, or a width-2 next to a width-1, and so on.
export const ROW_UNITS = 3

// Greedily pack items into rows of ROW_UNITS units, preserving item order. An
// item wider than a full row (width 4) simply gets a row of its own.
export const packRows = (items) => {
  const rows = []
  let row = []
  let used = 0
  for (const item of items) {
    const n = normalizeWidth(item.width)
    if (row.length && used + n > ROW_UNITS) {
      rows.push(row)
      row = []
      used = 0
    }
    row.push(item)
    used += n
  }
  if (row.length) rows.push(row)
  return rows
}
