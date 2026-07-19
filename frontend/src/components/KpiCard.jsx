import React from 'react'
import { formatCardValue, metricLabel } from '../lib/cardMetrics'

// One KPI tile: a title and a single computed value. `result` is the entry the
// backend returned for this card ({value, kind, detail?}); undefined means it is
// still loading, null/missing value renders a dash.
export default function KpiCard({ card, result, children }) {
  const loading = result === undefined
  const accent = card.accentColor || '#054239'

  return (
    <div
      className="group/card relative bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-3 flex flex-col justify-center min-h-[92px] hover:shadow-md transition-shadow"
      style={{ borderTopColor: accent, borderTopWidth: 3 }}
    >
      {children}
      <span className="text-[11px] font-bold text-gray-500 truncate" title={card.title}>
        {card.title || metricLabel(card.metric)}
      </span>
      {loading ? (
        <span className="mt-1 h-7 w-20 bg-gray-100 rounded animate-pulse" />
      ) : (
        <span className="mt-0.5 text-2xl font-bold truncate" style={{ color: accent }} title={String(result?.value ?? '')}>
          {formatCardValue(result)}
        </span>
      )}
      {result?.error && (
        <span className="text-[10px] text-red-400 truncate" title={result.error}>تعذر حساب القيمة</span>
      )}
    </div>
  )
}
