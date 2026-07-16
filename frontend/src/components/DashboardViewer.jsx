import React, { useState, useEffect } from 'react'
import { LayoutDashboard, Loader2, ArrowLeft, AlertCircle, Maximize2, X, Menu, ChevronRight } from 'lucide-react'
import { apiGet } from '../api'
import ChartView from './ChartView'
import { itemWidthPx, CARD_HEIGHT } from '../lib/dashboardLayout'

const noop = () => {}

// Read-only rendering of a dashboard: a left sidebar of tabs plus a wrapping row
// of fixed-width cards for the active tab's items (charts + images). Used both by
// grantees ("shared with me") and by managers previewing their own dashboard.
export default function DashboardViewer({ dashboardId, onBack }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [chartData, setChartData] = useState({})
  const [activeTabId, setActiveTabId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [expandedItem, setExpandedItem] = useState(null)

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

  return (
    <div className="flex h-full min-h-[70vh]" dir="rtl">
      {/* Sidebar with tabs */}
      {sidebarOpen ? (
        <aside className="w-56 shrink-0 bg-[#054239] text-white flex flex-col rounded-r-2xl overflow-hidden">
          <div className="px-4 py-4 border-b border-white/10">
            <div className="flex items-center justify-between mb-3">
              <button onClick={onBack} className="text-xs text-white/70 hover:text-white flex items-center gap-1 transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" /> رجوع
              </button>
              <button onClick={() => setSidebarOpen(false)} title="إخفاء الشريط الجانبي" className="text-white/70 hover:text-white transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <LayoutDashboard className="w-5 h-5 text-[#988561]" />
              <h2 className="text-sm font-bold truncate">{dashboard?.name}</h2>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`w-full text-right px-3 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                  activeTab?.id === tab.id ? 'bg-[#428177] text-white shadow-sm' : 'text-white/80 hover:bg-white/10'
                }`}
              >
                {tab.name}
              </button>
            ))}
          </nav>
        </aside>
      ) : (
        <button
          onClick={() => setSidebarOpen(true)}
          title="إظهار الشريط الجانبي"
          className="shrink-0 self-start m-3 p-2 rounded-xl bg-[#054239] text-white hover:bg-[#002623] transition-colors shadow-sm"
        >
          <Menu className="w-4 h-4" />
        </button>
      )}

      {/* Active tab content */}
      <main className="flex-1 overflow-auto p-6 bg-gray-50">
        {items.length === 0 ? (
          <div className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center">
            <LayoutDashboard className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">لا يوجد محتوى في هذا التبويب</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4 content-start">
            {items.map(item => (
              // The wrapper owns the fixed width; the card inside fills it and the
              // constant height keeps every card's bottom edge aligned.
              <div key={item.id} style={{ width: itemWidthPx(item.width) }} className="relative group shrink-0">
                <button
                  onClick={() => setExpandedItem(item)}
                  title="تكبير"
                  className="absolute top-2 left-2 z-10 p-1.5 rounded-lg bg-white/95 border border-gray-200 shadow-sm text-gray-500 hover:text-[#054239] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                {item.type === 'image' ? (
                  <img src={item.url} alt="" style={{ height: CARD_HEIGHT }} className="w-full rounded-xl border border-gray-200 shadow-sm object-contain bg-white" />
                ) : (
                  <ChartView
                    chart={{ ...item.config, id: item.id, chartWidth: '' }}
                    chartData={chartData[item.id] ?? null}
                    readOnly
                    fixedHeight={CARD_HEIGHT}
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

      {/* Expanded (fullscreen) view of a single item */}
      {expandedItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setExpandedItem(null) }}
          dir="rtl"
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-auto relative p-4" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setExpandedItem(null)}
              title="إغلاق"
              className="absolute top-3 left-3 z-10 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            {expandedItem.type === 'image' ? (
              <img src={expandedItem.url} alt="" className="w-full rounded-xl" />
            ) : (
              <ChartView
                chart={{ ...expandedItem.config, id: expandedItem.id, chartWidth: '' }}
                chartData={chartData[expandedItem.id] ?? null}
                readOnly
                fixedHeight={Math.round(Math.min(640, (typeof window !== 'undefined' ? window.innerHeight : 800) * 0.7))}
                onChartClick={noop}
                onEdit={noop}
                onDelete={noop}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
