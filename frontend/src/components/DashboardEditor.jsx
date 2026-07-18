import React, { useState, useEffect } from 'react'
import {
  LayoutDashboard, Loader2, ArrowLeft, Plus, Trash2, Save, Image as ImageIcon,
  BarChart3, Users, X, Check, Eye, ChevronLeft, ChevronRight, Pencil, Palette,
} from 'lucide-react'
import { apiGet, apiPut, apiPost, apiUpload } from '../api'
import ChartView from './ChartView'
import ChartStylePanel from './ChartStylePanel'
import DashboardViewer from './DashboardViewer'
import { WIDTH_CHOICES, DEFAULT_WIDTH, normalizeWidth, itemWidthPx, CARD_HEIGHT, packRows } from '../lib/dashboardLayout'

const uid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const noop = () => {}

// ---------------------------------------------------------------------------
// Modal: pick charts from the project's existing tabs to add to the dashboard.
// ---------------------------------------------------------------------------
function AddChartModal({ projectId, onAdd, onClose }) {
  const [trees, setTrees] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedTreeId, setSelectedTreeId] = useState('')
  const [selectedChartIds, setSelectedChartIds] = useState([])
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiGet('/api/global-chart-trees', { project_id: projectId })
        if (res.status === 'success') setTrees(res.data)
      } catch (err) {
        console.error('Failed to load tabs:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId])

  const selectedTree = trees.find(t => String(t.id) === String(selectedTreeId))
  const treeCharts = selectedTree?.structure?.charts || []

  const toggleChart = (id) => {
    setSelectedChartIds(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])
  }

  const handleAdd = async () => {
    if (!selectedTree || selectedChartIds.length === 0 || adding) return
    setAdding(true)
    try {
      // Fetch computed data for the selected tab so the added charts preview immediately.
      const res = await apiGet(`/api/global-chart-trees/${selectedTree.id}`, { include_chart_data: 1 })
      const data = res?.data?.chart_data || {}
      const items = []
      const dataMap = {}
      selectedChartIds.forEach(chartId => {
        const chart = treeCharts.find(c => c.id === chartId)
        if (!chart) return
        const itemId = uid('item')
        items.push({
          id: itemId,
          type: 'chart',
          file_id: selectedTree.file_id,
          width: DEFAULT_WIDTH,
          config: { ...chart, id: itemId },
        })
        dataMap[itemId] = data[chartId] ?? null
      })
      onAdd(items, dataMap)
      onClose()
    } catch (err) {
      alert(err.message || 'فشل إضافة المخططات')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose() }} dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center z-10">
          <h2 className="font-bold text-[#054239] text-base flex items-center gap-2"><BarChart3 className="w-5 h-5" /> إضافة مخططات</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[#428177]" /></div>
          ) : (
            <>
              <label className="text-xs font-bold text-gray-600 block mb-1">اختر التبويب</label>
              <select
                value={selectedTreeId}
                onChange={(e) => { setSelectedTreeId(e.target.value); setSelectedChartIds([]) }}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177] text-gray-700 mb-4 text-right"
              >
                <option value="">-- اختر تبويباً --</option>
                {trees.map(t => <option key={t.id} value={t.id}>{t.tree_name}</option>)}
              </select>

              {selectedTree && (
                treeCharts.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">لا توجد مخططات في هذا التبويب</p>
                ) : (
                  <div className="space-y-2 mb-4">
                    {treeCharts.map(chart => (
                      <label key={chart.id} className={`flex items-center gap-2 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${selectedChartIds.includes(chart.id) ? 'bg-[#054239]/10 border-[#428177]' : 'bg-white border-gray-200 hover:border-[#428177]'}`}>
                        <input type="checkbox" checked={selectedChartIds.includes(chart.id)} onChange={() => toggleChart(chart.id)} className="accent-[#054239]" />
                        <span className="text-xs font-bold text-[#002623]">{chart.title || `${chart.x} / ${chart.y}`}</span>
                        <span className="mr-auto text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{chart.type}</span>
                      </label>
                    ))}
                  </div>
                )
              )}

              <button
                onClick={handleAdd}
                disabled={adding || selectedChartIds.length === 0}
                className="w-full bg-[#054239] hover:bg-[#002623] disabled:bg-gray-300 text-white py-2.5 rounded-xl text-sm font-bold transition-all"
              >
                {adding ? 'جاري الإضافة...' : `إضافة (${selectedChartIds.length})`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal: grant / revoke view access for specific users.
// ---------------------------------------------------------------------------
function AccessModal({ dashboardId, onClose }) {
  const [users, setUsers] = useState([])
  const [granted, setGranted] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiGet(`/api/dashboards/${dashboardId}/access`)
        if (res.status === 'success') {
          setUsers(res.data.users || [])
          setGranted(res.data.granted_ids || [])
        }
      } catch (err) {
        console.error('Failed to load access:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [dashboardId])

  const toggle = (id) => setGranted(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const handleSave = async () => {
    setSaving(true)
    try {
      await apiPost(`/api/dashboards/${dashboardId}/access`, { user_ids: granted })
      onClose()
    } catch (err) {
      alert(err.message || 'فشل حفظ الصلاحيات')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose() }} dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center z-10">
          <h2 className="font-bold text-[#054239] text-base flex items-center gap-2"><Users className="w-5 h-5" /> إدارة الوصول</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-4">
          <p className="text-xs text-gray-500 mb-3">اختر المستخدمين المسموح لهم بمشاهدة هذه اللوحة (للعرض فقط).</p>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-[#428177]" /></div>
          ) : users.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">لا يوجد مستخدمون</p>
          ) : (
            <div className="space-y-2 mb-4">
              {users.map(u => (
                <label key={u.id} className={`flex items-center gap-2 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${granted.includes(u.id) ? 'bg-[#054239]/10 border-[#428177]' : 'bg-white border-gray-200 hover:border-[#428177]'}`}>
                  <input type="checkbox" checked={granted.includes(u.id)} onChange={() => toggle(u.id)} className="accent-[#054239]" />
                  <span className="text-sm font-bold text-[#002623]">{u.full_name}</span>
                  <span className="mr-auto text-[10px] text-gray-400">{u.username}</span>
                </label>
              ))}
            </div>
          )}
          <button onClick={handleSave} disabled={saving || loading} className="w-full bg-[#054239] hover:bg-[#002623] disabled:bg-gray-300 text-white py-2.5 rounded-xl text-sm font-bold transition-all">
            {saving ? 'جاري الحفظ...' : 'حفظ الصلاحيات'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main editor.
// ---------------------------------------------------------------------------
export default function DashboardEditor({ dashboard, project, onBack }) {
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState(dashboard.name || '')
  const [tabs, setTabs] = useState([])
  const [activeTabId, setActiveTabId] = useState(null)
  const [previewData, setPreviewData] = useState({}) // itemId -> chart data
  const [saving, setSaving] = useState(false)
  const [showAddChart, setShowAddChart] = useState(false)
  const [showAccess, setShowAccess] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [stylingItemId, setStylingItemId] = useState(null) // item whose تخصيص panel is open

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const res = await apiGet(`/api/dashboards/${dashboard.id}`)
        if (res.status === 'success') {
          setName(res.data.name)
          const loadedTabs = res.data.structure?.tabs || []
          setTabs(loadedTabs)
          setActiveTabId(loadedTabs[0]?.id || null)
          setPreviewData(res.data.chart_data || {})
        }
      } catch (err) {
        alert(err.message || 'فشل تحميل اللوحة')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [dashboard.id])

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0]

  const updateActiveItems = (updater) => {
    setTabs(prev => prev.map(t => t.id === activeTab.id ? { ...t, items: updater(t.items || []) } : t))
  }

  // --- Tab operations ---
  const addTab = () => {
    const newTab = { id: uid('tab'), name: `تبويب ${tabs.length + 1}`, items: [] }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
  }
  const renameTab = (id) => {
    const current = tabs.find(t => t.id === id)
    const next = prompt('اسم التبويب', current?.name || '')
    if (next && next.trim()) setTabs(prev => prev.map(t => t.id === id ? { ...t, name: next.trim() } : t))
  }
  const deleteTab = (id) => {
    if (tabs.length <= 1) { alert('يجب أن يبقى تبويب واحد على الأقل'); return }
    if (!confirm('حذف هذا التبويب وكل محتواه؟')) return
    setTabs(prev => {
      const remaining = prev.filter(t => t.id !== id)
      if (activeTabId === id) setActiveTabId(remaining[0]?.id || null)
      return remaining
    })
  }

  // --- Item operations ---
  const addCharts = (items, dataMap) => {
    updateActiveItems(list => [...list, ...items])
    setPreviewData(prev => ({ ...prev, ...dataMap }))
  }
  const handleUploadImage = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const res = await apiUpload('/api/reports/upload-image', file)
      const url = res?.data?.url
      if (url) updateActiveItems(list => [...list, { id: uid('item'), type: 'image', url, width: DEFAULT_WIDTH }])
    } catch (err) {
      alert(err.message || 'فشل رفع الصورة')
    } finally {
      setUploading(false)
    }
  }
  const removeItem = (itemId) => updateActiveItems(list => list.filter(i => i.id !== itemId))
  const setItemWidth = (itemId, n) => updateActiveItems(list => list.map(i => i.id === itemId ? { ...i, width: n } : i))
  // Styling lives on the dashboard's own copy of the chart config, so the source tab
  // (and every other report/dashboard using that chart) is left untouched.
  const setItemConfig = (itemId, config) => updateActiveItems(list => list.map(i => i.id === itemId ? { ...i, config } : i))
  const moveItem = (itemId, dir) => updateActiveItems(list => {
    const idx = list.findIndex(i => i.id === itemId)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= list.length) return list
    const copy = [...list]
    ;[copy[idx], copy[target]] = [copy[target], copy[idx]]
    return copy
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      await apiPut(`/api/dashboards/${dashboard.id}`, { name, structure: { tabs } })
      alert('تم حفظ اللوحة')
    } catch (err) {
      alert(err.message || 'فشل حفظ اللوحة')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-[#428177]" /></div>
  }

  if (previewMode) {
    return (
      <div>
        <div className="w-full px-4 pt-4" dir="rtl">
          <button onClick={() => setPreviewMode(false)} className="text-sm text-[#428177] hover:text-[#054239] flex items-center gap-1 font-bold mb-2">
            <Pencil className="w-4 h-4" /> العودة للتحرير
          </button>
        </div>
        <DashboardViewer dashboardId={dashboard.id} onBack={() => setPreviewMode(false)} />
      </div>
    )
  }

  const items = activeTab?.items || []

  return (
    <div className="w-full p-4" dir="rtl">
      {uploading && (
        <div className="fixed inset-0 bg-white/70 z-50 flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-[#428177]" />
        </div>
      )}

      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-[#428177] hover:text-[#054239] flex items-center gap-1 font-bold">
          <ArrowLeft className="w-4 h-4" /> العودة للوحات
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => setPreviewMode(true)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2">
            <Eye className="w-4 h-4" /> معاينة
          </button>
          <button onClick={() => setShowAccess(true)} className="bg-[#428177] hover:bg-[#1f5f54] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2">
            <Users className="w-4 h-4" /> إدارة الوصول
          </button>
          <button onClick={handleSave} disabled={saving} className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm mb-4 flex items-center gap-3">
        <LayoutDashboard className="w-6 h-6 text-[#054239] shrink-0" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-lg font-bold text-[#002623] border-b border-transparent hover:border-gray-200 focus:border-[#428177] focus:outline-none flex-1 bg-transparent"
          placeholder="اسم اللوحة"
        />
      </div>

      <div className="flex gap-4">
        {/* Tabs sidebar */}
        <aside className="w-52 shrink-0">
          <div className="bg-white border border-gray-200 rounded-2xl p-3 shadow-sm">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-bold text-gray-500">التبويبات</span>
              <button onClick={addTab} className="text-[#054239] hover:text-[#002623]" title="إضافة تبويب"><Plus className="w-4 h-4" /></button>
            </div>
            <div className="space-y-1">
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`group flex items-center justify-between px-3 py-2 rounded-xl text-sm font-bold cursor-pointer transition-colors ${activeTab?.id === tab.id ? 'bg-[#054239] text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  <span className="truncate">{tab.name}</span>
                  <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); renameTab(tab.id) }} title="إعادة تسمية"><Pencil className="w-3 h-3" /></button>
                    <button onClick={(e) => { e.stopPropagation(); deleteTab(tab.id) }} title="حذف"><Trash2 className="w-3 h-3" /></button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Active tab content */}
        <main className="flex-1">
          <div className="flex items-center gap-2 mb-4">
            <button onClick={() => setShowAddChart(true)} className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> إضافة مخطط
            </button>
            <label className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer border border-gray-200">
              <ImageIcon className="w-4 h-4" /> إضافة صورة
              <input type="file" accept="image/*" onChange={handleUploadImage} className="hidden" />
            </label>

            <span className="mr-auto text-[11px] text-gray-400">مرّر فوق أي مخطط لتحديد عرضه (1–4)</span>
          </div>

          {items.length === 0 ? (
            <div className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center">
              <LayoutDashboard className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">هذا التبويب فارغ. أضف مخططاً أو صورة.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
             {/* Same fixed rows as the viewer: each row totals ROW_UNITS width units. */}
             <div className="flex flex-col gap-4 w-max">
              {packRows(items).map((row, rowIndex) => (
               <div key={rowIndex} className="flex gap-4">
                {row.map(item => (
                <div key={item.id} style={{ width: itemWidthPx(item.width) }} className="relative group shrink-0">
                  {/* Item controls */}
                  <div className={`absolute top-2 left-2 z-10 flex items-center gap-1 bg-white/95 border border-gray-200 rounded-lg shadow-sm p-1 transition-opacity ${stylingItemId === item.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <button onClick={() => moveItem(item.id, -1)} className="p-1 text-gray-500 hover:text-[#054239]" title="تحريك لليسار"><ChevronRight className="w-3.5 h-3.5" /></button>
                    <button onClick={() => moveItem(item.id, 1)} className="p-1 text-gray-500 hover:text-[#054239]" title="تحريك لليمين"><ChevronLeft className="w-3.5 h-3.5" /></button>
                    <span className="w-px h-4 bg-gray-200 mx-0.5" />
                    {/* Chart width: units 1..4 × base width */}
                    {WIDTH_CHOICES.map(n => (
                      <button
                        key={n}
                        onClick={() => setItemWidth(item.id, n)}
                        title={`عرض ${n}`}
                        className={`w-5 h-5 rounded text-[10px] font-bold transition-colors ${
                          normalizeWidth(item.width) === n ? 'bg-[#054239] text-white' : 'text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                    {item.type !== 'image' && (
                      <>
                        <span className="w-px h-4 bg-gray-200 mx-0.5" />
                        <button
                          onClick={() => setStylingItemId(prev => prev === item.id ? null : item.id)}
                          className={`p-1 rounded transition-colors ${stylingItemId === item.id ? 'text-white bg-[#054239]' : 'text-gray-500 hover:text-[#054239]'}`}
                          title="تخصيص التصميم"
                        >
                          <Palette className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    <span className="w-px h-4 bg-gray-200 mx-0.5" />
                    <button onClick={() => removeItem(item.id)} className="p-1 text-red-400 hover:text-red-600" title="إزالة"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>

                  {stylingItemId === item.id && item.type !== 'image' && (
                    <ChartStylePanel
                      config={item.config || {}}
                      fileId={item.file_id}
                      onChange={(config) => setItemConfig(item.id, config)}
                      onClose={() => setStylingItemId(null)}
                    />
                  )}

                  {item.type === 'image' ? (
                    <img src={item.url} alt="" style={{ height: CARD_HEIGHT }} className="w-full rounded-xl border border-gray-200 shadow-sm object-contain bg-white" />
                  ) : (
                    <ChartView
                      chart={{ ...item.config, id: item.id, chartWidth: '' }}
                      chartData={previewData[item.id] ?? null}
                      readOnly
                      fixedHeight={CARD_HEIGHT}
                      onChartClick={noop} onEdit={noop} onDelete={noop}
                    />
                  )}
                </div>
                ))}
               </div>
              ))}
             </div>
            </div>
          )}
        </main>
      </div>

      {showAddChart && <AddChartModal projectId={project.id} onAdd={addCharts} onClose={() => setShowAddChart(false)} />}
      {showAccess && <AccessModal dashboardId={dashboard.id} onClose={() => setShowAccess(false)} />}
    </div>
  )
}
