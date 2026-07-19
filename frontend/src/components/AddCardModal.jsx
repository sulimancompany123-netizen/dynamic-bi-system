import React, { useEffect, useState } from 'react'
import { Loader2, X, LayoutList } from 'lucide-react'
import { apiGet, apiPost, LONG_TIMEOUT } from '../api'
import {
  DEFAULT_METRIC, metricsForColumnType, metricNeedsValue, defaultCardTitle,
} from '../lib/cardMetrics'

// Configure one KPI card: pick the source tab (which supplies the file), a column,
// a metric, and — for "تكرار قيمة محددة" — which value to count.
export default function AddCardModal({ projectId, onAdd, onClose }) {
  const [trees, setTrees] = useState([])
  const [loadingTrees, setLoadingTrees] = useState(true)
  const [selectedTreeId, setSelectedTreeId] = useState('')
  const [columns, setColumns] = useState([])
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [column, setColumn] = useState('')
  const [metric, setMetric] = useState(DEFAULT_METRIC)
  const [targetValue, setTargetValue] = useState('')
  const [categories, setCategories] = useState([])
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [accentColor, setAccentColor] = useState('#054239')

  const selectedTree = trees.find(t => String(t.id) === String(selectedTreeId))
  const fileId = selectedTree?.file_id
  const columnType = columns.find(c => c.name === column)?.type
  const availableMetrics = metricsForColumnType(columnType)
  const needsValue = metricNeedsValue(metric)

  useEffect(() => {
    apiGet('/api/global-chart-trees', { project_id: projectId })
      .then(res => { if (res.status === 'success') setTrees(res.data) })
      .catch(err => console.error('Failed to load tabs:', err))
      .finally(() => setLoadingTrees(false))
  }, [projectId])

  // Selecting a tab loads its file's columns so the user picks a real column.
  useEffect(() => {
    if (!fileId) { setColumns([]); setColumn(''); return }
    let cancelled = false
    setLoadingColumns(true)
    apiPost('/api/select-sheet', { file_id: fileId }, LONG_TIMEOUT)
      .then(res => {
        if (cancelled) return
        setColumns(res.status === 'success' && res.columns ? res.columns : [])
      })
      .catch(err => { if (!cancelled) { console.error('Failed to load columns:', err); setColumns([]) } })
      .finally(() => { if (!cancelled) setLoadingColumns(false) })
    return () => { cancelled = true }
  }, [fileId])

  // "تكرار قيمة محددة" needs the column's distinct values to choose from.
  useEffect(() => {
    if (!needsValue || !fileId || !column) { setCategories([]); return }
    let cancelled = false
    apiGet('/api/column-categories', { file_id: fileId, column })
      .then(data => { if (!cancelled) setCategories(data.categories || []) })
      .catch(err => console.error('Failed to load column values:', err))
    return () => { cancelled = true }
  }, [needsValue, fileId, column])

  // Keep the title in step with the selection until the user types their own.
  useEffect(() => {
    if (!titleTouched && column) setTitle(defaultCardTitle(column, metric))
  }, [column, metric, titleTouched])

  // A metric that doesn't apply to the newly picked column falls back to the default.
  useEffect(() => {
    if (column && !availableMetrics.some(m => m.value === metric)) setMetric(DEFAULT_METRIC)
  }, [column, availableMetrics, metric])

  const canAdd = fileId && column && metric && (!needsValue || targetValue !== '')

  const handleAdd = () => {
    if (!canAdd) return
    onAdd({
      file_id: fileId,
      column,
      metric,
      value: needsValue ? targetValue : '',
      title: title || defaultCardTitle(column, metric),
      accentColor,
    })
    onClose()
  }

  const field = 'w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177] text-gray-700 text-right'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose() }} dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center z-10">
          <h2 className="font-bold text-[#054239] text-base flex items-center gap-2">
            <LayoutList className="w-5 h-5" /> إضافة بطاقة
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-4 space-y-3">
          {loadingTrees ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[#428177]" /></div>
          ) : (
            <>
              <div>
                <label className="text-xs font-bold text-gray-600 block mb-1">مصدر البيانات (التبويب)</label>
                <select value={selectedTreeId} onChange={(e) => setSelectedTreeId(e.target.value)} className={field}>
                  <option value="">-- اختر تبويباً --</option>
                  {trees.map(t => <option key={t.id} value={t.id}>{t.tree_name}</option>)}
                </select>
              </div>

              {selectedTree && (
                <div>
                  <label className="text-xs font-bold text-gray-600 block mb-1">العمود</label>
                  {loadingColumns ? (
                    <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> جاري تحميل الأعمدة...
                    </div>
                  ) : (
                    <select value={column} onChange={(e) => setColumn(e.target.value)} className={field}>
                      <option value="">-- اختر العمود --</option>
                      {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                  )}
                </div>
              )}

              {column && (
                <div>
                  <label className="text-xs font-bold text-gray-600 block mb-1">القيمة المطلوبة</label>
                  <select value={metric} onChange={(e) => setMetric(e.target.value)} className={field}>
                    {availableMetrics.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              )}

              {column && needsValue && (
                <div>
                  <label className="text-xs font-bold text-gray-600 block mb-1">القيمة المراد عدّها</label>
                  {categories.length > 0 ? (
                    <select value={targetValue} onChange={(e) => setTargetValue(e.target.value)} className={field}>
                      <option value="">-- اختر القيمة --</option>
                      {categories.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input
                      type="text" value={targetValue} onChange={(e) => setTargetValue(e.target.value)}
                      placeholder="اكتب القيمة..." className={field}
                    />
                  )}
                </div>
              )}

              {column && (
                <>
                  <div>
                    <label className="text-xs font-bold text-gray-600 block mb-1">عنوان البطاقة</label>
                    <input
                      type="text" value={title}
                      onChange={(e) => { setTitle(e.target.value); setTitleTouched(true) }}
                      placeholder="اكتب عنواناً..." className={field}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-600 block mb-1">لون البطاقة</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)}
                        className="w-12 h-8 border rounded cursor-pointer"
                      />
                      <span className="text-[11px] font-mono font-bold text-gray-500 uppercase">{accentColor}</span>
                    </div>
                  </div>
                </>
              )}

              <button
                onClick={handleAdd}
                disabled={!canAdd}
                className="w-full bg-[#054239] hover:bg-[#002623] disabled:bg-gray-300 text-white py-2.5 rounded-xl text-sm font-bold transition-all"
              >
                إضافة البطاقة
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
