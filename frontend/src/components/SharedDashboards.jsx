import React, { useState, useEffect } from 'react'
import { LayoutDashboard, Loader2, FolderKanban } from 'lucide-react'
import { apiGet } from '../api'

// Landing area for users who have been granted view access to one or more dashboards.
// They own no projects, so this is their entry point to the dashboards shared with them.
export default function SharedDashboards({ onOpenDashboard }) {
  const [dashboards, setDashboards] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const res = await apiGet('/api/dashboards/shared')
        if (res.status === 'success') setDashboards(res.data)
      } catch (err) {
        console.error('Failed to load shared dashboards:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-[#428177]" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-6" dir="rtl">
      <div className="flex items-center gap-3 mb-6">
        <LayoutDashboard className="w-6 h-6 text-[#054239]" />
        <h2 className="text-xl font-bold text-[#002623]">اللوحات المشتركة معي</h2>
      </div>

      {dashboards.length === 0 ? (
        <div className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center">
          <LayoutDashboard className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">لا توجد لوحات مشتركة معك حتى الآن</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {dashboards.map(d => (
            <div
              key={d.id}
              onClick={() => onOpenDashboard(d)}
              className="bg-white border border-gray-200 rounded-2xl p-5 hover:border-[#428177] hover:shadow-md transition-all cursor-pointer"
            >
              <div className="flex items-center gap-3 mb-2">
                <LayoutDashboard className="w-5 h-5 text-[#428177]" />
                <span className="text-base font-bold text-[#002623]">{d.name}</span>
              </div>
              {d.project_name && (
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <FolderKanban className="w-3.5 h-3.5" /> {d.project_name}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
