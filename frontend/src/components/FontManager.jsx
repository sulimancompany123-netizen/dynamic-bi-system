import React, { useState, useEffect } from 'react'
import { X, Plus, Trash2, Loader2 } from 'lucide-react'
import { apiGet, apiPost, apiDelete } from '../api'
import { isLocalFont } from '../lib/localFonts'

export default function FontManager({ isAdmin, onClose, onFontAdded }) {
  const [fonts, setFonts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('sans-serif')
  const [adding, setAdding] = useState(false)

  const fetchFonts = async () => {
    setLoading(true)
    try {
      const res = await apiGet('/api/fonts')
      if (res.status === 'success') setFonts(res.data)
    } catch (err) {
      console.error('Failed to load fonts:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchFonts() }, [])

  const loadGoogleFont = (fontName) => {
    if (isLocalFont(fontName)) return // self-hosted via @font-face, not on Google
    const id = `font-link-${fontName.toLowerCase().replace(/\s+/g, '-')}`
    if (!document.getElementById(id)) {
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@400;700&display=swap`
      document.head.appendChild(link)
    }
  }

  const handleAdd = async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    setAdding(true)
    try {
      const fontFamily = `${trimmed}, sans-serif`
      const res = await apiPost('/api/fonts', { name: trimmed, font_family: fontFamily, category: newCategory })
      if (res.status === 'success') {
        loadGoogleFont(trimmed)
        setShowAdd(false)
        setNewName('')
        fetchFonts()
        onFontAdded?.()
      }
    } catch (err) {
      alert(err.message || 'فشل إضافة الخط')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('هل أنت متأكد من حذف هذا الخط؟')) return
    try {
      await apiDelete(`/api/fonts/${id}`)
      fetchFonts()
      onFontAdded?.()
    } catch (err) {
      alert('فشل حذف الخط')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center z-10">
          <h2 className="font-bold text-[#054239] text-base">إدارة الخطوط</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4">
          <button
            onClick={() => setShowAdd(true)}
            className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all mb-4"
          >
            <Plus className="w-4 h-4" /> إضافة خط خارجي (Google Fonts)
          </button>

          {showAdd && (
            <div className="bg-[#054239]/5 border border-[#428177] rounded-2xl p-4 mb-4 space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-600 block mb-1">اسم الخط (بالإنجليزية)</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="مثال: Amiri, Changa, Noto Kufi Arabic"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177] text-gray-700"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAdd(false) }}
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 block mb-1">التصنيف</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177]"
                >
                  <option value="sans-serif">Sans-serif</option>
                  <option value="serif">Serif</option>
                  <option value="display">Display</option>
                  <option value="handwriting">Handwriting</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAdd} disabled={adding} className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-50">
                  {adding ? 'جاري الإضافة...' : 'إضافة'}
                </button>
                <button onClick={() => setShowAdd(false)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold">إلغاء</button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-[#428177]" />
            </div>
          ) : fonts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">لا توجد خطوط بعد. أضف خطاً للبدء</p>
          ) : (
            <div className="space-y-2">
              {fonts.map(font => (
                <div key={font.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <div>
                    <span className="text-sm font-bold text-[#002623]" style={{ fontFamily: font.font_family }}>{font.name}</span>
                    <span className="mr-2 text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{font.category}</span>
                  </div>
                  {isAdmin && (
                    <button onClick={() => handleDelete(font.id)} className="text-red-400 hover:text-red-600 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}