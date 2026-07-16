import React, { useState, useEffect } from 'react'
import { FileText, Plus, Trash2, Loader2, FileSpreadsheet, ArrowLeft } from 'lucide-react'
import { apiGet, apiPost, apiDelete } from '../api'

export default function ReportList({ project, onBack, onOpenReport, isAdmin }) {
  const [reports, setReports] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [fromTemplateId, setFromTemplateId] = useState('')

  const fetchReports = async () => {
    setLoading(true)
    try {
      const res = await apiGet('/api/reports', { project_id: project.id })
      if (res.status === 'success') setReports(res.data)
    } catch (err) {
      console.error('Failed to load reports:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchTemplates = async () => {
    try {
      const res = await apiGet('/api/reports', { templates: 1 })
      if (res.status === 'success') setTemplates(res.data)
    } catch (err) {
      console.error('Failed to load templates:', err)
    }
  }

  useEffect(() => { fetchReports(); fetchTemplates() }, [project.id])

  const handleCreate = async () => {
    if (!newTitle.trim()) return
    try {
      const payload = {
        project_id: project.id,
        title: newTitle.trim(),
      }
      if (fromTemplateId) payload.from_template_id = parseInt(fromTemplateId)
      const res = await apiPost('/api/reports', payload)
      if (res.status === 'success') {
        setShowNew(false)
        setNewTitle('')
        setFromTemplateId('')
        // Open the new report directly so the copied template content is visible.
        if (res.data?.id) onOpenReport({ id: res.data.id })
        else fetchReports()
      }
    } catch (err) {
      alert(err.message || 'فشل إنشاء التقرير')
    }
  }

  const handleDelete = async (id, e) => {
    e.stopPropagation()
    if (!confirm('هل أنت متأكد من حذف هذا التقرير؟')) return
    try {
      const res = await apiDelete(`/api/reports/${id}`)
      if (res.status === 'success') fetchReports()
    } catch (err) {
      alert('فشل حذف التقرير')
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
      <div className="mb-4">
        <button onClick={onBack} className="text-sm text-[#428177] hover:text-[#054239] flex items-center gap-1 transition-colors font-bold">
          <ArrowLeft className="w-4 h-4" /> العودة للمشروع
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-[#054239]" />
            <h2 className="text-xl font-bold text-[#002623]">تقارير {project.name}</h2>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"
          >
            <Plus className="w-4 h-4" /> تقرير جديد
          </button>
        </div>

        {showNew && (
          <div className="bg-[#054239]/5 border border-[#428177] rounded-2xl p-4 mb-4">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="عنوان التقرير"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177] text-gray-700 mb-2"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNew(false) }}
              autoFocus
            />
            <label className="block text-xs font-bold text-gray-600 mb-1">ابدأ من قالب (اختياري)</label>
            <select
              value={fromTemplateId}
              onChange={(e) => setFromTemplateId(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177] text-gray-700 mb-3 text-right"
            >
              <option value="">بدون قالب (تقرير فارغ)</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button onClick={handleCreate} className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2 rounded-xl text-xs font-bold">إنشاء</button>
              <button onClick={() => setShowNew(false)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold">إلغاء</button>
            </div>
          </div>
        )}

        {reports.length === 0 ? (
          <div className="border-2 border-dashed border-gray-300 rounded-2xl p-10 text-center">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">لا توجد تقارير بعد. أنشئ تقريراً جديداً للبدء</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {reports.map(report => (
              <div
                key={report.id}
                onClick={() => onOpenReport(report)}
                className="bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-[#428177] hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-4 h-4 text-[#428177]" />
                  <div>
                    <span className="text-sm font-bold text-[#002623]">{report.title}</span>
                    <p className="text-[10px] text-gray-400 mt-0.5">بواسطة {report.user_name} | {new Date(report.created_at).toLocaleDateString('ar-SA')}</p>
                  </div>
                </div>
                <span onClick={(e) => handleDelete(report.id, e)} className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-red-500 hover:text-red-700">
                  <Trash2 className="w-4 h-4" />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
