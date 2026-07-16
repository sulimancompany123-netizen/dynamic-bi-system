import React, { useState, useEffect } from 'react';
import { FolderOpen, Plus, Upload, Loader2, Trash2, FileSpreadsheet, ArrowLeft, Home, Check, AlertCircle, Layers, BarChart3, FileText, Table2, ArrowRight, RefreshCw, LayoutDashboard } from 'lucide-react';
import { apiGet, apiPost, apiDelete, apiUpload } from '../api';
import { clearChartDataCache } from '../extensions/ChartNode';

export default function ProjectDetail({ project, onBack, onOpenTab, isAdmin, onEnterCharts, onOpenReports, onOpenDashboards }) {
  const [loading, setLoading] = useState(true);
  const [projectData, setProjectData] = useState(null);
  const [error, setError] = useState(null);
  const [showAddTab, setShowAddTab] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState('');
  const [tabName, setTabName] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [commonColumn, setCommonColumn] = useState('');
  const [sheet1Columns, setSheet1Columns] = useState([]);
  const [joinType, setJoinType] = useState('inner');
  const [submitting, setSubmitting] = useState(false);
  const [uploadMode, setUploadMode] = useState('single');

  useEffect(() => {
    fetchProjectDetail();
  }, [project.id]);

  useEffect(() => {
    if (uploadResult && uploadMode === 'concat' && selectedSheets.length > 0) {
      fetchSheetColumns(selectedSheets[0]);
    }
  }, [uploadMode, selectedSheets, uploadResult]);

  const fetchProjectDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet(`/api/projects/${project.id}`);
      if (res.status === 'success') {
        setProjectData(res.data);
      } else {
        setError('فشل تحميل تفاصيل المشروع');
      }
    } catch (err) {
      setError('فشل الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  };

  const fetchSheetColumns = async (sheetName) => {
    if (!uploadResult?.file_id) return;
    const data = await apiPost('/api/sheet-columns', { file_id: uploadResult.file_id, sheet_name: sheetName });
    if (data.status === 'success') {
      setSheet1Columns(data.columns || []);
      setCommonColumn('');
    }
  };

  const handleCreateTab = async () => {
    if (!selectedFileId || !tabName.trim()) return;
    try {
      const res = await apiPost('/api/global-chart-trees', {
        file_id: parseInt(selectedFileId),
        project_id: project.id,
        tree_name: tabName.trim(),
        structure: {
          charts: [],
          breadcrumbs: [{ id: 'root', name: 'الرئيسية', filter: {} }],
          deleted_columns: [],
          column_filters: {}
        }
      });
      if (res.status === 'success') {
        setShowAddTab(false);
        setSelectedFileId('');
        setTabName('');
        fetchProjectDetail();
      }
    } catch (err) {
      alert(err.message || 'فشل إنشاء التبويب');
    }
  };

  const handleDeleteTab = async (tabId, e) => {
    e.stopPropagation();
    if (!confirm('هل أنت متأكد من حذف هذا التبويب؟')) return;
    try {
      const res = await apiDelete(`/api/global-chart-trees/${tabId}`);
      if (res.status === 'success') {
        fetchProjectDetail();
      }
    } catch (err) {
      alert('فشل حذف التبويب');
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await apiUpload('/api/data-files/upload', file, { project_id: project.id }, 300000);
      if (result.status === 'success' || result.file_id) {
        if (result.multi_sheet) {
          setUploadResult(result);
          setSelectedSheets([]);
          setCommonColumn('');
          setSheet1Columns([]);
          setUploadMode('single');
        } else {
          alert('تم رفع الملف بنجاح');
          setShowUpload(false);
          fetchProjectDetail();
        }
      } else {
        alert(result.detail || 'حدث خطأ أثناء رفع الملف');
      }
    } catch (err) {
      alert(err.message || 'فشل الاتصال بالسيرفر');
    } finally {
      setUploading(false);
    }
    e.target.value = '';
  };

  const handleReplaceFile = async (fileId, e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm('سيتم استبدال بيانات هذا الملف بالكامل مع الإبقاء على التبويبات والمخططات المبنية عليه. هل تريد المتابعة؟')) return;
    setUploading(true);
    try {
      const result = await apiUpload(`/api/data-files/${fileId}/replace`, file, {}, 300000);
      if (result.status === 'success' || result.file_id) {
        // The file's data changed but its id/columns did not, so any in-memory chart-data
        // cache for it is now stale (this is why reports kept showing the old numbers).
        clearChartDataCache(fileId);
        if (result.multi_sheet) {
          // Multi-sheet workbook: drive sheet selection / merge against the same file_id
          // through the existing upload result panel.
          setShowUpload(false);
          setUploadResult(result);
          setSelectedSheets([]);
          setCommonColumn('');
          setSheet1Columns([]);
          setUploadMode('single');
        } else {
          alert('تم استبدال الملف بنجاح');
          fetchProjectDetail();
        }
      } else {
        alert(result.detail || 'حدث خطأ أثناء استبدال الملف');
      }
    } catch (err) {
      alert(err.message || 'فشل الاتصال بالسيرفر');
    } finally {
      setUploading(false);
    }
  };

  const handleSelectSheet = async () => {
    if (selectedSheets.length !== 1 || !uploadResult?.file_id) return;
    setSubmitting(true);
    try {
      const data = await apiPost('/api/select-sheet', { file_id: uploadResult.file_id, sheet_name: selectedSheets[0] }, 300000);
      if (data.status === 'success') {
        clearChartDataCache(uploadResult.file_id);
        setUploadResult(null);
        setShowUpload(false);
        fetchProjectDetail();
      } else {
        alert(data.detail || 'حدث خطأ');
      }
    } catch (err) {
      alert(err.message || 'فشل الاتصال بالسيرفر');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMergeSheets = async () => {
    if (selectedSheets.length < 2 || !commonColumn || !uploadResult?.file_id) {
      alert('يرجى اختيار ورقتين أو أكثر والعمود المشترك');
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiPost('/api/merge-multiple-sheets', {
        file_id: uploadResult.file_id,
        sheets: selectedSheets,
        common_column: commonColumn,
        how: joinType,
      }, 300000);
      if (data.status === 'success') {
        clearChartDataCache(uploadResult.file_id);
        setUploadResult(null);
        setShowUpload(false);
        fetchProjectDetail();
      } else {
        alert(data.detail || 'حدث خطأ');
      }
    } catch (err) {
      alert(err.message || 'فشل الاتصال بالسيرفر');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSheet = (sheetName) => {
    setSelectedSheets(prev => {
      if (prev.includes(sheetName)) return prev.filter(s => s !== sheetName);
      return [...prev, sheetName];
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-[#428177]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
        <button onClick={onBack} className="text-sm text-[#428177] hover:text-[#054239] flex items-center gap-1 transition-colors font-bold">
          <ArrowLeft className="w-4 h-4" /> العودة للمشاريع
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6" dir="rtl">
      {uploading && (
        <div className="fixed inset-0 bg-white/80 z-50 flex flex-col items-center justify-center">
          <Loader2 className="w-12 h-12 animate-spin text-[#428177] mb-4" />
          <p className="text-lg font-bold text-[#002623]">جاري رفع الملف ومعالجته...</p>
          <p className="text-xs text-gray-400 mt-2">قد تستغرق هذه العملية بعض الوقت للملفات الكبيرة</p>
        </div>
      )}
      {submitting && (
        <div className="fixed inset-0 bg-white/80 z-50 flex flex-col items-center justify-center">
          <Loader2 className="w-12 h-12 animate-spin text-[#428177] mb-4" />
          <p className="text-lg font-bold text-[#002623]">جاري معالجة الورقة وتحويل البيانات...</p>
          <p className="text-xs text-gray-400 mt-2">قد تستغرق هذه العملية بعض الوقت للملفات الكبيرة</p>
        </div>
      )}

      <div className="mb-4">
        <button onClick={onBack} className="text-sm text-[#428177] hover:text-[#054239] flex items-center gap-1 transition-colors font-bold">
          <ArrowLeft className="w-4 h-4" /> العودة للمشاريع
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FolderOpen className="w-8 h-8 text-[#054239]" />
            <div>
              <h2 className="text-2xl font-bold text-[#002623]">{projectData?.name}</h2>
              {projectData?.description && (
                <p className="text-sm text-gray-500 mt-1">{projectData.description}</p>
              )}
              <p className="text-xs text-gray-400 mt-1">
                {projectData?.data_files_count || 0} ملفات | {projectData?.tabs?.length || 0} تبويبات
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenDashboards(projectData)}
              className="bg-[#8e7b5b] hover:bg-[#6f5f45] text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
            >
              <LayoutDashboard className="w-4 h-4" /> لوحات المعلومات
            </button>
            <button
              onClick={() => onOpenReports(projectData)}
              className="bg-[#428177] hover:bg-[#1f5f54] text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
            >
              <FileText className="w-4 h-4" /> التقارير
            </button>
            <button
              onClick={() => onEnterCharts(projectData)}
              className="bg-[#054239] hover:bg-[#002623] text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-sm"
            >
              <BarChart3 className="w-4 h-4" /> عرض المخططات
            </button>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold text-[#002623] flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#428177]" /> التبويبات
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowUpload(true); setUploadResult(null); }}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all border border-gray-200"
            >
              <Upload className="w-3.5 h-3.5" /> رفع ملف
            </button>
            <button
              onClick={() => setShowAddTab(true)}
              className="bg-[#054239] hover:bg-[#002623] text-white px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" /> إضافة تبويب
            </button>
          </div>
        </div>

        {showAddTab && (
          <div className="bg-[#054239]/5 border border-[#428177] rounded-2xl p-4 mb-4">
            <div className="flex gap-3 items-start">
              <div className="flex-1">
                <select
                  value={selectedFileId}
                  onChange={(e) => setSelectedFileId(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177] text-gray-700 mb-2"
                >
                  <option value="">-- اختر ملفاً --</option>
                  {(projectData?.files || []).map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={tabName}
                  onChange={(e) => setTabName(e.target.value)}
                  placeholder="اسم التبويب"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177] text-gray-700 mb-2"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTab(); if (e.key === 'Escape') setShowAddTab(false); }}
                  autoFocus
                />
              </div>
              <div className="flex gap-1 pt-1">
                <button onClick={handleCreateTab} className="bg-[#054239] hover:bg-[#002623] text-white px-3 py-2 rounded-xl text-xs font-bold transition-all">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => setShowAddTab(false)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-xl text-xs font-bold transition-all">
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}

        {showUpload && !uploadResult && (
          <div className="bg-[#054239]/5 border border-[#428177] rounded-2xl p-4 mb-4">
            <p className="text-sm font-bold text-[#002623] mb-3">رفع ملف للمشروع</p>
            <input
              type="file"
              accept=".csv, .xlsx, .xls"
              onChange={handleFileUpload}
              disabled={uploading}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-[#054239] file:text-white hover:file:bg-[#002623] disabled:opacity-50"
            />
            {uploading && <p className="text-xs text-[#428177] mt-2">جاري رفع الملف...</p>}
            <button onClick={() => setShowUpload(false)} className="text-xs text-gray-400 hover:text-gray-600 mt-2">إلغاء</button>
          </div>
        )}

        {uploadResult && (
          <div className="bg-[#054239]/5 border border-[#428177] rounded-2xl p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-[#002623]">اختيار الأوراق في ملف Excel</h4>
              <button onClick={() => setUploadResult(null)} className="text-xs text-[#8e7b5b] hover:text-[#054239] transition-colors">تغيير الملف</button>
            </div>
            <p className="text-xs text-gray-500 mb-3">يحتوي الملف على <span className="font-bold text-[#054239]">{(uploadResult.sheets || []).length}</span> أوراق</p>

            <div className="flex gap-2 mb-4">
              <button onClick={() => setUploadMode('single')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all ${uploadMode === 'single' ? 'bg-[#054239] text-white border-[#054239]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#428177]'}`}>
                <Table2 className="w-3.5 h-3.5 inline ml-1" /> ورقة واحدة
              </button>
              <button onClick={() => setUploadMode('concat')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold border-2 transition-all ${uploadMode === 'concat' ? 'bg-[#054239] text-white border-[#054239]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#428177]'}`}>
                <Layers className="w-3.5 h-3.5 inline ml-1" /> دمج الأوراق
              </button>
            </div>

            {uploadMode === 'single' ? (
              <div className="space-y-3">
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {(uploadResult.sheets || []).map(s => (
                    <label key={s} className={`flex items-center gap-2 p-2 rounded-xl border-2 cursor-pointer transition-all ${selectedSheets.includes(s) && selectedSheets.length === 1 ? 'bg-[#054239]/10 border-[#428177]' : 'bg-white border-gray-200 hover:border-[#428177]'}`}>
                      <input type="radio" name="singleSheet" checked={selectedSheets.includes(s) && selectedSheets.length === 1}
                        onChange={() => setSelectedSheets([s])} className="accent-[#054239]" />
                      <span className="text-xs font-medium text-gray-700">{s}</span>
                    </label>
                  ))}
                </div>
                <button onClick={handleSelectSheet} disabled={submitting || selectedSheets.length !== 1}
                  className="w-full bg-[#054239] hover:bg-[#002623] disabled:bg-gray-300 text-white py-2 rounded-xl text-xs font-bold transition-all">
                  {submitting ? 'جاري التحميل...' : 'تحميل الورقة'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {(uploadResult.sheets || []).map(s => (
                    <label key={s} className={`flex items-center gap-2 p-2 rounded-xl border-2 cursor-pointer transition-all ${selectedSheets.includes(s) ? 'bg-[#054239]/10 border-[#428177]' : 'bg-white border-gray-200 hover:border-[#428177]'}`}>
                      <input type="checkbox" checked={selectedSheets.includes(s)}
                        onChange={() => toggleSheet(s)} className="accent-[#054239]" />
                      <span className="text-xs font-medium text-gray-700">{s}</span>
                    </label>
                  ))}
                </div>
                {selectedSheets.length >= 2 && (
                  <div>
                    <label className="text-xs font-bold text-gray-600 block mb-1">العمود المشترك (من {selectedSheets[0]})</label>
                    <select value={commonColumn} onChange={(e) => setCommonColumn(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#428177]">
                      <option value="">-- اختر العمود --</option>
                      {sheet1Columns.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
                    </select>
                  </div>
                )}
                {selectedSheets.length >= 2 && (
                  <div>
                    <label className="text-xs font-bold text-gray-600 block mb-1">نوع الدمج</label>
                    <select value={joinType} onChange={(e) => setJoinType(e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#428177]">
                      <option value="inner">داخلي (inner)</option>
                      <option value="left">أيسر (left)</option>
                      <option value="right">أيمن (right)</option>
                      <option value="outer">خارجي (outer)</option>
                    </select>
                  </div>
                )}
                <button onClick={handleMergeSheets} disabled={submitting || selectedSheets.length < 2 || !commonColumn}
                  className="w-full bg-[#054239] hover:bg-[#002623] disabled:bg-gray-300 text-white py-2 rounded-xl text-xs font-bold transition-all">
                  {submitting ? 'جاري الدمج...' : 'دمج الأوراق وتحميل'}
                </button>
              </div>
            )}
          </div>
        )}

        {(!projectData?.tabs || projectData.tabs.length === 0) ? (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-10 text-center">
            <Layers className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">لا توجد تبويبات بعد. قم برفع ملف ثم أضف تبويباً لبدء التحليل</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(projectData?.tabs || []).map(tab => (
              <div
                key={tab.id}
                onClick={() => onOpenTab(tab, projectData?.files?.find(f => f.id === tab.file_id))}
                className="bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-[#428177] hover:shadow-md transition-all cursor-pointer flex items-center gap-2 group"
              >
                <FileSpreadsheet className="w-4 h-4 text-[#428177]" />
                <span className="text-sm font-bold text-[#002623]">{tab.tree_name}</span>
                <span
                  onClick={(e) => handleDeleteTab(tab.id, e)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-red-500 hover:text-red-700"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-lg font-bold text-[#002623] mb-3 flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-[#428177]" /> ملفات المشروع
        </h3>
        {(projectData?.files && projectData.files.length > 0) ? (
          <div className="grid gap-3">
            {projectData.files.map(file => (
              <div key={file.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between hover:border-[#428177] transition-all">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-[#054239]" />
                  <div>
                    <span className="text-sm font-bold text-[#002623]">{file.name}</span>
                    <p className="text-xs text-gray-400">تم الرفع بواسطة: {file.uploaded_by || 'غير معروف'}</p>
                  </div>
                </div>
                <label
                  title="استبدال الملف مع الإبقاء على التبويبات والمخططات"
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all border border-gray-200 ${uploading ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer'}`}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> استبدال الملف
                  <input
                    type="file"
                    accept=".csv, .xlsx, .xls"
                    disabled={uploading}
                    onChange={(e) => handleReplaceFile(file.id, e)}
                    className="hidden"
                  />
                </label>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-10 text-center">
            <FileSpreadsheet className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">لا توجد ملفات في هذا المشروع</p>
          </div>
        )}
      </div>
    </div>
  );
}