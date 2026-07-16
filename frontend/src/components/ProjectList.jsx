import React, { useState, useEffect } from 'react';
import { FolderKanban, Plus, Loader2, Trash2, Users, AlertCircle, FolderOpen } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '../api';

export default function ProjectList({ onSelectProject, onShowUpload, onShowUsers, isAdmin, user }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet('/api/projects');
      if (res.status === 'success') {
        setProjects(res.data);
      } else {
        setError('فشل تحميل قائمة المشاريع');
      }
    } catch (err) {
      setError('فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const res = await apiPost('/api/projects', { name: newName.trim(), description: newDescription.trim() });
      if (res.status === 'success' && res.data) {
        setShowCreateInput(false);
        setNewName('');
        setNewDescription('');
        fetchProjects();
      }
    } catch (err) {
      alert('فشل إنشاء المشروع');
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm('هل أنت متأكد من حذف هذا المشروع؟')) return;
    try {
      const res = await apiDelete(`/api/projects/${id}`);
      if (res.status === 'success') {
        setProjects(prev => prev.filter(p => p.id !== id));
      }
    } catch (err) {
      alert('فشل حذف المشروع');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-[#428177]" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[#002623]">المشاريع</h2>
          <p className="text-sm text-gray-500 mt-1">اختر مشروعاً لعرض وتحليل البيانات</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={onShowUsers}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all border border-gray-200"
            >
              <Users className="w-4 h-4" /> إدارة المستخدمين
            </button>
          )}
          <button
            onClick={() => setShowCreateInput(true)}
            className="bg-[#054239] hover:bg-[#002623] text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" /> مشروع جديد
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {showCreateInput && (
        <div className="bg-white border border-[#428177] rounded-2xl p-6 mb-6 shadow-sm">
          <h3 className="text-sm font-bold text-[#002623] mb-4">مشروع جديد</h3>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="اسم المشروع"
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm mb-3 text-right focus:outline-none focus:ring-2 focus:ring-[#428177] text-gray-700"
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreateInput(false); }}
            autoFocus
          />
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="وصف المشروع (اختياري)"
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm mb-3 text-right focus:outline-none focus:ring-2 focus:ring-[#428177] text-gray-700 resize-none"
            rows={2}
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="bg-[#054239] hover:bg-[#002623] text-white px-5 py-2 rounded-xl text-sm font-bold transition-all">
              إنشاء
            </button>
            <button onClick={() => setShowCreateInput(false)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-2 rounded-xl text-sm font-bold transition-all">
              إلغاء
            </button>
          </div>
        </div>
      )}

      {projects.length === 0 && !error && !showCreateInput && (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center">
          <FolderKanban className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-500 mb-2">لا توجد مشاريع بعد</h3>
          <p className="text-sm text-gray-400 mb-6">قم بإنشاء مشروع جديد لتنظيم ملفات البيانات والمخططات</p>
          <button
            onClick={() => setShowCreateInput(true)}
            className="bg-[#054239] hover:bg-[#002623] text-white px-6 py-3 rounded-xl font-bold text-sm inline-flex items-center gap-2 transition-all"
          >
            <Plus className="w-4 h-4" /> إنشاء مشروع
          </button>
        </div>
      )}

      <div className="grid gap-4">
        {projects.map((project) => (
          <div
            key={project.id}
            onClick={() => onSelectProject(project)}
            className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#428177] hover:shadow-md transition-all cursor-pointer flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#054239]/10 rounded-xl flex items-center justify-center">
                <FolderOpen className="w-6 h-6 text-[#054239]" />
              </div>
              <div>
                <h4 className="font-bold text-[#002623]">{project.name}</h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  {project.description && <span>{project.description} | </span>}
                  {project.data_files_count || 0} ملفات | تم الإنشاء بواسطة: {project.created_by || 'غير معروف'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onSelectProject(project); }}
                className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2 rounded-lg text-xs font-bold transition-all"
              >
                فتح
              </button>
              <button
                onClick={(e) => handleDelete(project.id, e)}
                className="bg-red-50 hover:bg-red-100 text-red-600 p-2 rounded-lg transition-all"
                title="حذف المشروع"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}