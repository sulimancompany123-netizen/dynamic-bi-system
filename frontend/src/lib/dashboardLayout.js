// Column layout for dashboard tabs. A tab stores `columns` (1..4); items stored
// with width 'full' span the whole row, 'half' takes a single column.
// Class names are written out in full because Tailwind only keeps classes it can
// find literally in the source.

export const DEFAULT_COLUMNS = 2
export const COLUMN_CHOICES = [1, 2, 3, 4]

const GRID_CLASSES = {
  1: 'grid grid-cols-1 gap-4',
  2: 'grid grid-cols-1 md:grid-cols-2 gap-4',
  3: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4',
  4: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4',
}

const FULL_SPAN_CLASSES = {
  1: '',
  2: 'md:col-span-2',
  3: 'md:col-span-2 lg:col-span-3',
  4: 'md:col-span-2 lg:col-span-4',
}

export const normalizeColumns = (value) => {
  const n = Number(value)
  return COLUMN_CHOICES.includes(n) ? n : DEFAULT_COLUMNS
}

export const gridClass = (columns) => GRID_CLASSES[normalizeColumns(columns)]

export const itemSpanClass = (columns, width) =>
  width === 'full' ? FULL_SPAN_CLASSES[normalizeColumns(columns)] : ''
