import React, { useState, useEffect } from 'react';
import { Upload, ArrowLeft, Layers, Table2, Loader2 } from 'lucide-react';
import { apiPost, apiUpload } from '../api';

const TIMEOUT_MSG = 'انتهت مهلة الاتصال — الملف كبير جداً، يرجى المحاولة مرة أخرى';
const FILE_TIMEOUT = 300000;

function isAbortError(err) {
  return err && (err.name === 'AbortError' || (err instanceof DOMException && err.name === 'AbortError'));
}

export default function FileUpload({ onUploadSuccess, loading, fileName, setLoading, token, projectId }) {
  const [uploadResult, setUploadResult] = useState(null);
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [commonColumn, setCommonColumn] = useState('');
  const [sheet1Columns, setSheet1Columns] = useState([]);
  const [joinType, setJoinType] = useState('inner');
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState('single');
  const [fileNameInput, setFileNameInput] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);

  const sheets = uploadResult?.sheets || [];

  useEffect(() => {
    if (mode === 'concat' && selectedSheets.length > 0) {
      fetchSheetColumns(selectedSheets[0]);
    }
  }, [mode, selectedSheets]);

  useEffect(() => {
    if (mode === 'single') {
      setCommonColumn('');
      setSheet1Columns([]);
    }
  }, [mode]);

  const fetchSheetColumns = async (sheetName) => {
    if (!uploadResult?.file_id) return;
    const data = await apiPost('/api/sheet-columns', { file_id: uploadResult.file_id, sheet_name: sheetName });
    if (data.status === 'success') {
      setSheet1Columns(data.columns);
      setCommonColumn('');
    }
  };

  const toggleSheet = (sheetName) => {
    setSelectedSheets(prev => {
      if (prev.includes(sheetName)) {
        return prev.filter(s => s !== sheetName);
      }
      return [...prev, sheetName];
    });
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSelectedFile(file);
  };

  const handleSubmit = async () => {
    if (!selectedFile) return;
    setLoading(true);
    try {
      const additionalFields = { name: fileNameInput.trim() };
      if (projectId) {
        additionalFields.project_id = projectId;
      }
      const result = await apiUpload('/api/data-files/upload', selectedFile, additionalFields, FILE_TIMEOUT);
      if (result.status === 'success') {
        if (result.multi_sheet) {
          setUploadResult(result);
          setSelectedSheets([]);
          setCommonColumn('');
          setSheet1Columns([]);
          setMode('single');
        } else {
          alert('تم رفع الملف بنجاح');
          onUploadSuccess(result);
        }
      } else {
        alert(result.detail || 'حدث خطأ أثناء رفع الملف');
      }
    } catch (error) {
      alert(isAbortError(error) ? TIMEOUT_MSG : 'فشل الاتصال بالسيرفر');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSheet = async () => {
    if (selectedSheets.length !== 1 || !uploadResult?.file_id) return;
    setSubmitting(true);
    try {
      const data = await apiPost('/api/select-sheet', { file_id: uploadResult.file_id, sheet_name: selectedSheets[0] }, FILE_TIMEOUT);
      if (data.status === 'success') {
        onUploadSuccess({ ...data, filename: uploadResult.filename, file_id: uploadResult.file_id });
      } else {
        alert(data.detail || 'حدث خطأ');
      }
    } catch (error) {
      alert(isAbortError(error) ? TIMEOUT_MSG : 'فشل الاتصال بالسيرفر');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMergeMultiple = async () => {
    if (selectedSheets.length < 2 || !commonColumn || !uploadResult?.file_id) {
      alert('يرجى اختيار 2 أوراق أو أكثر والعمود المشترك');
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiPost('/api/merge-multiple-sheets', {
        file_id: uploadResult.file_id,
        sheets: selectedSheets,
        common_column: commonColumn,
        how: joinType,
      }, FILE_TIMEOUT);
      if (data.status === 'success') {
        onUploadSuccess({ ...data, filename: uploadResult.filename, file_id: uploadResult.file_id });
      } else {
        alert(data.detail || 'حدث خطأ');
      }
    } catch (error) {
      alert(isAbortError(error) ? TIMEOUT_MSG : 'فشل الاتصال بالسيرفر');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setUploadResult(null);
    setSelectedSheets([]);
    setCommonColumn('');
    setSheet1Columns([]);
  };

  if (uploadResult) {
    return (
      <>
        {submitting && (
          <div className="fixed inset-0 bg-white/80 z-50 flex flex-col items-center justify-center">
            <Loader2 className="w-12 h-12 animate-spin text-[#428177] mb-4" />
            <p className="text-lg font-bold text-[#002623]">جاري معالجة الورقة وتحويل البيانات...</p>
            <p className="text-xs text-gray-400 mt-2">قد تستغرق هذه العملية بعض الوقت للملفات الكبيرة</p>
          </div>
        )}
        <div className="max-w-2xl mx-auto mt-10 bg-white border-2 border-[#428177] rounded-2xl p-8 shadow-md text-right" dir="rtl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Layers className="w-6 h-6 text-[#428177]" />
            <h3 className="text-lg font-bold text-[#002623]">تحديد الأوراق في ملف Excel</h3>
          </div>
          <button onClick={handleReset} className="text-sm text-[#8e7b5b] hover:text-[#054239] flex items-center gap-1 transition-colors">
            <ArrowLeft className="w-4 h-4" /> تغيير الملف
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">يحتوي الملف على <span className="font-bold text-[#054239]">{sheets.length}</span> أوراق. اختر طريقة التحميل:</p>

        <div className="flex gap-3 mb-6">
          <button onClick={() => setMode('single')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-bold border-2 transition-all ${mode === 'single' ? 'bg-[#054239] text-white border-[#054239]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#428177]'}`}>
            <Table2 className="w-4 h-4 inline ml-1" /> ورقة واحدة
          </button>
          <button onClick={() => setMode('concat')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-bold border-2 transition-all ${mode === 'concat' ? 'bg-[#054239] text-white border-[#054239]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#428177]'}`}>
            <Layers className="w-4 h-4 inline ml-1" /> دمج الأوراق
          </button>
        </div>

        {mode === 'single' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">اختر الورقة المراد تحميلها</label>
              <div className="space-y-2">
                {sheets.map(s => (
                  <label key={s} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${selectedSheets.includes(s) && selectedSheets.length === 1 ? 'bg-[#054239]/10 border-[#428177]' : 'bg-white border-gray-200 hover:border-[#428177]'}`}>
                    <input type="radio" name="singleSheet" checked={selectedSheets.includes(s) && selectedSheets.length === 1}
                      onChange={() => setSelectedSheets([s])} className="accent-[#054239]" />
                    <span className="text-sm font-medium text-gray-700">{s}</span>
                  </label>
                ))}
              </div>
            </div>
            <button onClick={handleSelectSheet} disabled={submitting || selectedSheets.length !== 1}
              className="w-full bg-[#054239] hover:bg-[#002623] disabled:bg-gray-300 text-white py-3 rounded-xl font-bold text-sm transition-all">
              {submitting ? 'جاري التحميل...' : 'تحميل الورقة'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1.5">اختر الأوراق المراد دمجها (2 أو أكثر)</label>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {sheets.map(s => (
                  <label key={s} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${selectedSheets.includes(s) ? 'bg-[#054239]/10 border-[#428177]' : 'bg-white border-gray-200 hover:border-[#428177]'}`}>
                    <input type="checkbox" checked={selectedSheets.includes(s)}
                      onChange={() => toggleSheet(s)} className="accent-[#054239]" />
                    <span className="text-sm font-medium text-gray-700">{s}</span>
                  </label>
                ))}
              </div>
              {selectedSheets.length > 0 && (
                <p className="text-xs text-[#428177] mt-2">تم اختيار {selectedSheets.length} أوراق</p>
              )}
            </div>
            {selectedSheets.length >= 2 && (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">العمود المشترك (من الورقة الأولى المختارة: {selectedSheets[0]})</label>
                <select value={commonColumn} onChange={(e) => setCommonColumn(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177]">
                  <option value="">-- اختر العمود --</option>
                  {sheet1Columns.map(c => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
                </select>
              </div>
            )}
            {selectedSheets.length >= 2 && (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">نوع الدمج</label>
                <select value={joinType} onChange={(e) => setJoinType(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#428177]">
                  <option value="inner">داخلي (inner) - السجلات المشتركة فقط</option>
                  <option value="left">أيسر (left) - جميع سجلات الورقة الأولى</option>
                  <option value="right">أيمن (right) - جميع سجلات الورقة الأخيرة</option>
                  <option value="outer">خارجي (outer) - جميع السجلات</option>
                </select>
              </div>
            )}
            <button onClick={handleMergeMultiple} disabled={submitting || selectedSheets.length < 2 || !commonColumn}
              className="w-full bg-[#054239] hover:bg-[#002623] disabled:bg-gray-300 text-white py-3 rounded-xl font-bold text-sm transition-all">
              {submitting ? 'جاري الدمج...' : 'دمج الأوراق وتحميل'}
            </button>
          </div>
        )}
      </div>
      </>
    );
  }

  return (
    <>
      {loading && (
        <div className="fixed inset-0 bg-white/80 z-50 flex flex-col items-center justify-center">
          <Loader2 className="w-12 h-12 animate-spin text-[#428177] mb-4" />
          <p className="text-lg font-bold text-[#002623]">جاري معالجة الملف وتحليل البيانات...</p>
          <p className="text-xs text-gray-400 mt-2">قد تستغرق هذه العملية بعض الوقت للملفات الكبيرة</p>
        </div>
      )}
      <div className="max-w-2xl mx-auto mt-20 bg-white border-2 border-dashed border-[#428177] rounded-2xl p-10 text-center shadow-md">
      <Upload className="w-16 h-16 text-[#054239] mx-auto mb-4 animate-pulse" />
      <h3 className="text-lg font-bold text-[#002623] mb-2">رفع ملف البيانات الخاص بك</h3>
      <p className="text-sm text-gray-500 mb-6">يدعم النظام ملفات Excel (.xlsx) أو CSV لتوليد المخططات الهرمية</p>

      <input type="text" value={fileNameInput} onChange={(e) => setFileNameInput(e.target.value)}
        placeholder="أدخل اسماً للملف (اختياري)"
        className="w-full max-w-xs mx-auto block border border-gray-300 rounded-xl px-4 py-2.5 text-sm mb-4 text-right focus:outline-none focus:ring-2 focus:ring-[#428177] text-gray-700" />

      <label className="bg-[#054239] hover:bg-[#002623] text-white px-6 py-3 rounded-xl font-bold text-sm shadow-md cursor-pointer transition-all inline-block">
        {loading ? 'جاري معالجة الملف...' : (selectedFile ? 'تغيير الملف' : 'اختر ملفاً من جهازك')}
        <input type="file" accept=".csv, .xlsx, .xls" className="hidden" onChange={handleFileChange} disabled={loading} />
      </label>
      {selectedFile && <p className="mt-3 text-sm text-[#428177] font-medium">{selectedFile.name}</p>}
      <button onClick={handleSubmit} disabled={!selectedFile || loading}
        className="mt-3 w-full max-w-xs mx-auto block bg-[#054239] hover:bg-[#002623] disabled:bg-gray-300 text-white py-3 rounded-xl font-bold text-sm transition-all">
        {loading ? 'جاري رفع الملف...' : 'رفع الملف'}
      </button>
      {fileName && <p className="mt-3 text-xs text-[#8e7b5b] font-medium">{fileName}</p>}
      </div>
    </>
  );
}