// KPI card metrics. Each card is one column + one metric, computed server-side by
// the `card-metrics` reader command. `numericOnly` metrics are offered only for
// numeric columns; `needsValue` metrics ask the user which value to count.

export const CARD_METRICS = [
  { value: 'count', label: 'عدد القيم (بدون الفارغة)' },
  { value: 'distinct', label: 'عدد القيم الفريدة' },
  { value: 'mode', label: 'القيمة الأكثر تكراراً' },
  { value: 'value_count', label: 'تكرار قيمة محددة', needsValue: true },
  { value: 'sum', label: 'المجموع', numericOnly: true },
  { value: 'average', label: 'المتوسط', numericOnly: true },
  { value: 'min', label: 'أصغر قيمة', numericOnly: true },
  { value: 'max', label: 'أكبر قيمة', numericOnly: true },
]

export const DEFAULT_METRIC = 'count'

export const metricLabel = (metric) =>
  CARD_METRICS.find(m => m.value === metric)?.label || metric

export const metricNeedsValue = (metric) =>
  !!CARD_METRICS.find(m => m.value === metric)?.needsValue

// Metrics offered for a column of the given type. Unknown/missing type: offer all.
export const metricsForColumnType = (type) =>
  type && type !== 'numeric' ? CARD_METRICS.filter(m => !m.numericOnly) : CARD_METRICS

// A sensible default title, e.g. "متوسط الراتب" — the user can overwrite it.
export const defaultCardTitle = (column, metric) => `${metricLabel(metric)} — ${column}`

// Format a computed value for display. Numbers get thousands separators; a missing
// value renders as a dash so the card keeps its shape.
export const formatCardValue = (result) => {
  if (!result || result.value === null || result.value === undefined) return '—'
  if (result.kind === 'number' && typeof result.value === 'number') {
    return result.value.toLocaleString('en-US')
  }
  return String(result.value)
}
