import React, { useState, useEffect } from 'react'
import { LayoutDashboard, Plus, Trash2, Loader2, ArrowLeft, Users } from 'lucide-react'
import { apiGet, apiPost, apiDelete } from '../api'

// Lists the dashboards of a project for someone who can manage them (admin or the
// project owner). Create opens the editor directly; each row opens the editor too.
export default function DashboardList({ project, onBack, onOpenDashboard }) {
  const [dashboards, setDashboards] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchDashboards = async () => {
    setLoading(true)
    try {
      const res = await apiGet('/api/dashboards', { project_id: project.id })
      if (res.status === 'success') setDashboards(res.data)
    } catch (err) {
      console.error('Failed to load dashboards:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchDashboards() }, [project.id])

  const handleCreate = async () => {
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const res = await apiPost('/api/dashboards', { project_id: project.id, name: newName.trim() })
      if (res.status === 'success' && res.data?.id) {
        setShowNew(false)
        setNewName('')
        onOpenDashboard({ id: res.data.id, name: res.data.name })
      }
    } catch (err) {
      alert(err.message || 'فشل إنشاء اللوحة')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id, e) => {
    e.stopPropagation()
    if (!confirm('هل أنت متأكد من حذف هذه اللوحة؟')) return
    try {
      const res = await apiDelete(`/api/dashboards/${id}`)
      if (res.status === 'success') fetchDashboards()
    } catch (err) {
      alert('فشل حذف اللوحة')
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
            <LayoutDashboard className="w-6 h-6 text-[#054239]" />
            <h2 className="text-xl font-bold text-[#002623]">لوحات معلومات {project.name}</h2>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"
          >
            <Plus className="w-4 h-4" /> لوحة جديدة
          </button>
        </div>

        {showNew && (
          <div className="bg-[#054239]/5 border border-[#428177] rounded-2xl p-4 mb-4">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="اسم اللوحة"
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177] text-gray-700 mb-3"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowNew(false) }}
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={handleCreate} disabled={creating} className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-50">
                {creating ? 'جاري الإنشاء...' : 'إنشاء'}
              </button>
              <button onClick={() => setShowNew(false)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold">إلغاء</button>
            </div>
          </div>
        )}

        {dashboards.length === 0 ? (
          <div className="border-2 border-dashed border-gray-300 rounded-2xl p-10 text-center">
            <LayoutDashboard className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">لا توجد لوحات بعد. أنشئ لوحة جديدة للبدء</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {dashboards.map(d => (
              <div
                key={d.id}
                onClick={() => onOpenDashboard(d)}
                className="bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-[#428177] hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <LayoutDashboard className="w-4 h-4 text-[#428177]" />
                  <div>
                    <span className="text-sm font-bold text-[#002623]">{d.name}</span>
                    <p className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-2">
                      <span>{d.tabs_count} تبويب</span>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {d.viewers_count} مستخدم</span>
                    </p>
                  </div>
                </div>
                <span onClick={(e) => handleDelete(d.id, e)} className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-red-500 hover:text-red-700">
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
