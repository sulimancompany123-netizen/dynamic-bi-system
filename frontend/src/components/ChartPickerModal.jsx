import React, { useState, useEffect } from 'react'
import { X, Loader2, ChevronDown, ChevronLeft, BarChart3 } from 'lucide-react'
import { apiGet } from '../api'

export default function ChartPickerModal({ projectId, onSelect, onClose }) {
  const [trees, setTrees] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedTreeId, setExpandedTreeId] = useState(null)

  useEffect(() => {
    fetchTrees()
  }, [])

  const fetchTrees = async () => {
    setLoading(true)
    try {
      const res = await apiGet('/api/global-chart-trees', { project_id: projectId })
      if (res.status === 'success') setTrees(res.data || [])
    } catch (err) {
      console.error('Failed to load chart trees:', err)
    } finally {
      setLoading(false)
    }
  }

  const getChartsFromTree = (tree) => {
    const structure = tree.structure || {}
    return structure.charts || []
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center z-10">
          <h2 className="font-bold text-[#054239] text-base">اختيار مخطط</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[#428177]" />
            </div>
          ) : trees.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">لا توجد أشجار مخططات في هذا المشروع</p>
          ) : (
            <div className="space-y-3">
              {trees.map(tree => {
                const charts = getChartsFromTree(tree)
                const isExpanded = expandedTreeId === tree.id
                return (
                  <div key={tree.id} className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedTreeId(isExpanded ? null : tree.id)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-right"
                    >
                      <span className="text-sm font-bold text-[#002623]">{tree.tree_name}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-400 bg-white px-2 py-0.5 rounded-full">{charts.length} مخطط</span>
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronLeft className="w-4 h-4 text-gray-400" />}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="divide-y divide-gray-100">
                        {charts.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-4">لا توجد مخططات في هذه الشجرة</p>
                        ) : (
                          charts.map((chart, idx) => (
                            <button
                              key={chart.id || idx}
                              onClick={() => onSelect({ tree, chart })}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#054239]/5 transition-colors text-right group"
                            >
                              <BarChart3 className="w-5 h-5 text-[#428177] shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-[#002623] truncate">{chart.title || `مخطط ${idx + 1}`}</p>
                                <p className="text-[10px] text-gray-400">
                                  {chart.type === 'bar' ? 'أعمدة' :
                                   chart.type === 'horizontal_bar' ? 'أعمدة أفقية' :
                                   chart.type === 'pie' ? 'دائري' :
                                   chart.type === 'donut' ? 'حلقة' :
                                   chart.type === 'line' ? 'خطي' :
                                   chart.type === 'area' ? 'مساحي' :
                                   chart.type === 'scatter' ? 'مبعثر' :
                                   chart.type === 'funnel' ? 'قمعي' :
                                   chart.type === 'treemap' ? 'Treemap' :
                                   chart.type === 'sunburst' ? 'Sunburst' :
                                   chart.type === 'polarBar' ? 'أعمدة قطبي' : chart.type}
                                  {chart.x ? ` | ${chart.x}` : ''}
                                  {chart.y ? ` / ${chart.y}` : ''}
                                </p>
                              </div>
                              <span className="text-xs font-bold text-[#054239] opacity-0 group-hover:opacity-100 transition-opacity">إدراج</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}