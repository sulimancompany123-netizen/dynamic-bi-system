import React, { useState, useEffect } from 'react'
import { LayoutDashboard, Loader2, ArrowLeft, AlertCircle } from 'lucide-react'
import { apiGet } from '../api'
import ChartView from './ChartView'
import { gridClass, itemSpanClass, normalizeColumns } from '../lib/dashboardLayout'

const noop = () => {}

// Read-only rendering of a dashboard: a left sidebar of tabs plus a responsive grid
// of the active tab's items (charts + images). Used both by grantees ("shared with
// me") and by managers previewing their own dashboard.
export default function DashboardViewer({ dashboardId, onBack }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [chartData, setChartData] = useState({})
  const [activeTabId, setActiveTabId] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await apiGet(`/api/dashboards/${dashboardId}`)
        if (cancelled) return
        if (res.status === 'success') {
          setDashboard(res.data)
          setChartData(res.data.chart_data || {})
          const tabs = res.data.structure?.tabs || []
          setActiveTabId(tabs[0]?.id || null)
        } else {
          setError('فشل تحميل اللوحة')
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'غير مصرح بالوصول إلى هذه اللوحة')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [dashboardId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-[#428177]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-6" dir="rtl">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
        <button onClick={onBack} className="text-sm text-[#428177] hover:text-[#054239] flex items-center gap-1 transition-colors font-bold">
          <ArrowLeft className="w-4 h-4" /> رجوع
        </button>
      </div>
    )
  }

  const tabs = dashboard?.structure?.tabs || []
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0]
  const items = activeTab?.items || []
  const columns = normalizeColumns(activeTab?.columns)

  return (
    <div className="flex h-full min-h-[70vh]" dir="rtl">
      {/* Sidebar with tabs */}
      <aside className="w-56 shrink-0 bg-[#054239] text-white flex flex-col rounded-r-2xl overflow-hidden">
        <div className="px-4 py-4 border-b border-white/10">
          <button onClick={onBack} className="text-xs text-white/70 hover:text-white flex items-center gap-1 mb-3 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> رجوع
          </button>
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-5 h-5 text-[#988561]" />
            <h2 className="text-sm font-bold truncate">{dashboard?.name}</h2>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`w-full text-right px-4 py-2.5 text-sm font-bold transition-colors ${
                activeTab?.id === tab.id ? 'bg-gray-50 text-[#054239]' : 'text-white/80 hover:bg-white/10'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </nav>
      </aside>

      {/* Active tab content */}
      <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
        {items.length === 0 ? (
          <div className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center">
            <LayoutDashboard className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">لا يوجد محتوى في هذا التبويب</p>
          </div>
        ) : (
          <div className={gridClass(columns)}>
            {items.map(item => (
              // The wrapper owns the col-span so ChartView's own span classes stay inert
              // and the tab's column count decides the layout.
              <div key={item.id} className={itemSpanClass(columns, item.width)}>
                {item.type === 'image' ? (
                  <img src={item.url} alt="" className="w-full rounded-xl border border-gray-200 shadow-sm" />
                ) : (
                  <ChartView
                    chart={{ ...item.config, id: item.id, chartWidth: '' }}
                    chartData={chartData[item.id] ?? null}
                    readOnly
                    onChartClick={noop}
                    onEdit={noop}
                    onDelete={noop}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
