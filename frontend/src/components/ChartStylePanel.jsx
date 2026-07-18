import React, { useEffect, useState } from 'react'
import { Palette, X } from 'lucide-react'
import { apiGet } from '../api'

// Per-card styling popover for a dashboard chart, mirroring the report's "تخصيص"
// panel. It edits only the *look* of the card (colors, font, bar thickness, card
// background) — the data (x/y/type) still comes from the source tab. Every change
// is applied live through `onChange`; the dashboard's حفظ button persists it.
export default function ChartStylePanel({ config, fileId, onChange, onClose }) {
  const [fonts, setFonts] = useState([])
  const [categories, setCategories] = useState([])

  const colorMode = config.colorMode || 'single'
  const bgOpacityPct = Math.round((config.bgOpacity ?? 1) * 100)
  const isBarChart = config.type === 'bar' || config.type === 'horizontal_bar'

  const set = (patch) => onChange({ ...config, ...patch })

  useEffect(() => {
    let cancelled = false
    apiGet('/api/fonts')
      .then(res => { if (!cancelled && res.status === 'success') setFonts(res.data || []) })
      .catch(err => console.error('Failed to load fonts:', err))
    return () => { cancelled = true }
  }, [])

  // Manual mode needs the column's distinct values so each one gets its own swatch.
  useEffect(() => {
    if (colorMode !== 'manual' || !fileId || !config.x) { setCategories([]); return }
    let cancelled = false
    apiGet('/api/column-categories', { file_id: fileId, column: config.x })
      .then(data => { if (!cancelled) setCategories(data.categories || []) })
      .catch(err => console.error('Failed to load column categories:', err))
    return () => { cancelled = true }
  }, [colorMode, fileId, config.x])

  // Switching to manual with no palette yet: seed one so the chart doesn't go blank.
  const selectColorMode = (mode) => {
    if (mode === 'manual' && !config.customCategoryColors) {
      set({ colorMode: mode, customCategoryColors: {} })
    } else {
      set({ colorMode: mode })
    }
  }

  const setCategoryColor = (cat, color) => {
    set({ customCategoryColors: { ...(config.customCategoryColors || {}), [cat]: color } })
  }

  const modeBtn = (mode, label) => (
    <button
      type="button"
      onClick={() => selectColorMode(mode)}
      className={`py-1 text-[10px] font-bold rounded border transition-colors ${
        colorMode === mode ? 'bg-[#054239] text-white border-[#054239]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#428177]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div
      className="absolute top-10 left-2 z-30 w-64 max-h-[70vh] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-right custom-scrollbar"
      onClick={(e) => e.stopPropagation()}
      dir="rtl"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-[#054239] flex items-center gap-1">
          <Palette className="w-3.5 h-3.5 text-[#8e7b5b]" /> تخصيص المخطط
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title="إغلاق">
          <X className="w-4 h-4" />
        </button>
      </div>

      <label className="text-[11px] font-bold text-gray-500 block mb-1">نظام التلوين</label>
      <div className="grid grid-cols-3 gap-1 mb-2">
        {modeBtn('single', 'لون موحد')}
        {modeBtn('multi', 'أوتوماتيكي')}
        {modeBtn('manual', 'بيدي 🎨')}
      </div>

      {colorMode === 'single' && (
        <div className="mb-2">
          <label className="text-[11px] font-bold text-gray-500 block mb-1">لون البيانات</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="flex-1 h-8 rounded border cursor-pointer"
              value={config.themeColor || '#054239'}
              onChange={(e) => set({ themeColor: e.target.value })}
            />
            <span className="text-[10px] font-mono font-bold text-gray-600 uppercase">{config.themeColor || '#054239'}</span>
          </div>
        </div>
      )}

      {colorMode === 'manual' && (
        categories.length === 0 ? (
          <p className="text-[11px] text-amber-600 mb-2">لا توجد أقسام لهذا العمود بعد.</p>
        ) : (
          <div className="mb-2 space-y-1 max-h-40 overflow-y-auto border-y border-gray-100 py-2 custom-scrollbar">
            {categories.map(cat => (
              <div key={cat} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-gray-700 truncate">{cat}</span>
                <input
                  type="color"
                  className="w-8 h-6 rounded border cursor-pointer shrink-0"
                  value={config.customCategoryColors?.[cat] || '#428177'}
                  onChange={(e) => setCategoryColor(cat, e.target.value)}
                />
              </div>
            ))}
          </div>
        )
      )}

      <label className="text-[11px] font-bold text-gray-500 block mb-1">نوع الخط</label>
      <select
        className="w-full border border-gray-300 rounded-md p-1.5 text-xs bg-white mb-2"
        value={config.fontFamily || 'Cairo, sans-serif'}
        onChange={(e) => set({ fontFamily: e.target.value })}
      >
        {fonts.map(f => <option key={f.font_family} value={f.font_family}>{f.name} ({f.category})</option>)}
        {/* Keep the current family selectable even if it isn't in the fonts table. */}
        {!fonts.some(f => f.font_family === (config.fontFamily || 'Cairo, sans-serif')) && (
          <option value={config.fontFamily || 'Cairo, sans-serif'}>{config.fontFamily || 'Cairo, sans-serif'}</option>
        )}
      </select>

      <label className="text-[11px] font-bold text-gray-500 block mb-1">حجم الخط ({config.fontSize || 14}px)</label>
      <input
        type="range" min="10" max="22"
        className="w-full accent-[#054239] mb-2"
        value={config.fontSize || 14}
        onChange={(e) => set({ fontSize: parseInt(e.target.value, 10) })}
      />

      {isBarChart && (
        <>
          <label className="text-[11px] font-bold text-gray-500 block mb-1">سماكة الأعمدة ({config.barWidth || 50}%)</label>
          <input
            type="range" min="10" max="90" step="5"
            className="w-full accent-[#428177] mb-2"
            value={config.barWidth || 50}
            onChange={(e) => set({ barWidth: parseInt(e.target.value, 10) })}
          />
        </>
      )}

      <label className="text-[11px] font-bold text-gray-500 block mb-1">خلفية البطاقة</label>
      <div className="flex items-center gap-2 mb-2">
        <input
          type="color"
          className="flex-1 h-8 rounded border cursor-pointer"
          value={config.bgColor || '#ffffff'}
          onChange={(e) => set({ bgColor: e.target.value })}
        />
        <button
          type="button"
          onClick={() => set({ bgColor: null })}
          className="text-[11px] text-gray-500 hover:text-red-500 font-bold"
        >
          بدون
        </button>
      </div>

      <label className="text-[11px] font-bold text-gray-500 block mb-1">شفافية الخلفية: {bgOpacityPct}%</label>
      <input
        type="range" min="0" max="100" step="5"
        className="w-full accent-[#988561] mb-3"
        value={bgOpacityPct}
        onChange={(e) => set({ bgOpacity: (parseInt(e.target.value, 10) || 0) / 100 })}
      />

      <button
        type="button"
        onClick={onClose}
        className="w-full bg-[#054239] hover:bg-[#002623] text-white text-xs font-bold py-1.5 rounded-lg transition-colors"
      >
        تم
      </button>
    </div>
  )
}
