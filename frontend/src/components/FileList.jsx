import React, { useState, useEffect } from 'react';
import { FileSpreadsheet, Upload, Users, Loader2, AlertCircle } from 'lucide-react';
import { apiGet } from '../api';

export default function FileList({ onSelectFile, onShowUpload, onShowUsers, isAdmin, projectId }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchFiles();
  }, [projectId]);

  const fetchFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (projectId) {
        params.project_id = projectId;
      }
      const res = await apiGet('/api/data-files', params);
      if (res.status === 'success') {
        setFiles(res.data);
      } else {
        setError('فشل تحميل قائمة الملفات');
      }
    } catch (err) {
      setError('فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
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
          <h2 className="text-2xl font-bold text-[#002623]">ملفات البيانات</h2>
          <p className="text-sm text-gray-500 mt-1">اختر ملفاً لبدء التحليل أو قم برفع ملف جديد</p>
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
            onClick={onShowUpload}
            className="bg-[#054239] hover:bg-[#002623] text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
          >
            <Upload className="w-4 h-4" /> رفع ملف جديد
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {files.length === 0 && !error && (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center">
          <FileSpreadsheet className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-500 mb-2">لا توجد ملفات بعد</h3>
          <p className="text-sm text-gray-400 mb-6">قم برفع ملف Excel أو CSV لبدء التحليل</p>
          <button
            onClick={onShowUpload}
            className="bg-[#054239] hover:bg-[#002623] text-white px-6 py-3 rounded-xl font-bold text-sm inline-flex items-center gap-2 transition-all"
          >
            <Upload className="w-4 h-4" /> رفع ملف
          </button>
        </div>
      )}

      <div className="grid gap-4">
        {files.map((file) => (
          <div
            key={file.id}
            onClick={() => onSelectFile(file)}
            className="bg-white border border-gray-200 rounded-xl p-5 hover:border-[#428177] hover:shadow-md transition-all cursor-pointer flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#054239]/10 rounded-xl flex items-center justify-center">
                <FileSpreadsheet className="w-6 h-6 text-[#054239]" />
              </div>
              <div>
                <h4 className="font-bold text-[#002623]">{file.name}</h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  تم الرفع بواسطة: {file.uploaded_by || 'غير معروف'} | {file.created_at ? new Date(file.created_at).toLocaleDateString('ar-SA') : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); onSelectFile(file); }}
                className="bg-[#054239] hover:bg-[#002623] text-white px-4 py-2 rounded-lg text-xs font-bold transition-all"
              >
                تحليل
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}