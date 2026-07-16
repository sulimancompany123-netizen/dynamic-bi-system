import React, { useState, useEffect } from 'react'
import { LayoutTemplate, Plus, Trash2, Loader2, FileText, ArrowLeft, AlertCircle } from 'lucide-react'
import { apiGet, apiPost, apiDelete } from '../api'

export default function TemplateList({ onOpenTemplate, onBack, isAdmin }) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const fetchTemplates = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet('/api/reports', { templates: 1 })
      if (res.status === 'success') setTemplates(res.data)
      else setError('فشل تحميل القوالب')
    } catch (err) {
      setError('فشل الاتصال بالخادم')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTemplates() }, [])

  const handleCreate = async () => {
    if (!newTitle.trim()) return
    try {
      const res = await apiPost('/api/reports', {
        title: newTitle.trim(),
        is_template: true,
      })
      if (res.status === 'success' && res.data) {
        setShowNew(false)
        setNewTitle('')
        onOpenTemplate({ id: res.data.id })
      }
    } catch (err) {
      alert(err.message || 'فشل إنشاء القالب')
    }
  }

  const handleDelete = async (id, e) => {
    e.stopPropagation()
    if (!confirm('هل أنت متأكد من حذف هذا القالب؟')) return
    try {
      const res = await apiDelete(`/api/reports/${id}`)
      if (res.status === 'success') setTemplates(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      alert('فشل حذف القالب')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-[#428177]" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-6" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[#002623] flex items-center gap-2">
            <LayoutTemplate className="w-6 h-6 text-[#054239]" /> قوالب التقارير
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {isAdmin ? 'كل القوالب في المنظومة' : 'قوالبك الخاصة'} — استخدمها كنقطة بداية عند إنشاء تقرير جديد
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"
        >
          <Plus className="w-4 h-4" /> قالب جديد
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {showNew && (
        <div className="bg-[#054239]/5 border border-[#428177] rounded-2xl p-4 mb-4">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="اسم القالب"
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177] text-gray-700 mb-3 text-right"
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNew(false) }}
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2 rounded-xl text-xs font-bold">إنشاء وفتح المحرر</button>
            <button onClick={() => setShowNew(false)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold">إلغاء</button>
          </div>
        </div>
      )}

      {templates.length === 0 && !showNew ? (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center">
          <LayoutTemplate className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-500 mb-2">لا توجد قوالب بعد</h3>
          <p className="text-sm text-gray-400">أنشئ قالباً لإعادة استخدامه عند كتابة التقارير</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map(t => (
            <div
              key={t.id}
              onClick={() => onOpenTemplate(t)}
              className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#428177] hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-[#054239]/10 rounded-xl flex items-center justify-center">
                  <FileText className="w-6 h-6 text-[#054239]" />
                </div>
                <div>
                  <h4 className="font-bold text-[#002623]">{t.title}</h4>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {t.user_name && <span>بواسطة: {t.user_name} | </span>}
                    {t.updated_at ? new Date(t.updated_at).toLocaleDateString('ar-SA') : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenTemplate(t); }}
                  className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2 rounded-lg text-xs font-bold transition-all"
                >
                  فتح
                </button>
                <button
                  onClick={(e) => handleDelete(t.id, e)}
                  className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-lg text-xs font-bold transition-all border border-red-200"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6">
        <button onClick={onBack} className="text-sm text-[#428177] hover:text-[#054239] flex items-center gap-1 transition-colors font-bold">
          <ArrowLeft className="w-4 h-4" /> العودة
        </button>
      </div>
    </div>
  )
}
