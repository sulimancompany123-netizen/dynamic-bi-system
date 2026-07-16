import React, { useEffect, useState } from 'react';
import { Layout, Palette, Sliders, Trash2, Plus, Filter, Undo2 } from 'lucide-react';
import { apiGet, apiPost } from '../api';
import FontManager from './FontManager';

export default function Sidebar({
  allColumns, isAnalysisStarted, selectedX, setSelectedX, selectedY, setSelectedY,
  chartType, setChartType, chartTitle, setChartTitle, themeColor, setThemeColor,
  fontSize, setFontSize, compatibleCharts, onAddChart,
  chartWidth, setChartWidth, chartHeight, setChartHeight,
  barWidth, setBarWidth, colorMode, setColorMode,
  customCategoryColors, setCustomCategoryColors,
  onDeleteColumn, onRestoreColumn,
  fontFamily, setFontFamily = () => {}, fonts = [],
  token, fileId, onFontAdded,
  columnFilters, onColumnFilterChange,
  deletedColumnNames
}) {
  const [uniqueCategories, setUniqueCategories] = useState([]);
  const [showFontManager, setShowFontManager] = useState(false);
  const [expandedFilterColumn, setExpandedFilterColumn] = useState(null);
  const [columnDetailsCache, setColumnDetailsCache] = useState({});

  useEffect(() => {
    if (selectedX && colorMode === 'manual' && fileId) {
      const fetchCategories = async () => {
        try {
          const data = await apiGet('/api/column-categories', { file_id: fileId, column: selectedX });
          setUniqueCategories(data.categories || []);

          if (Object.keys(customCategoryColors).length === 0) {
            const initialColors = {};
            const defaultPalette = ['#054239', '#428177', '#8e7b5b', '#988561', '#1f5f54'];
            (data.categories || []).forEach((cat, index) => {
              initialColors[cat] = defaultPalette[index % defaultPalette.length];
            });
            setCustomCategoryColors(initialColors);
          }
        } catch (err) {
          console.error("Error fetching column categories:", err);
        }
      };
      fetchCategories();
    } else {
      setUniqueCategories([]);
    }
  }, [selectedX, colorMode, fileId]);

  const handleColorChange = (category, color) => {
    setCustomCategoryColors(prev => ({ ...prev, [category]: color }));
  };

  const fetchColumnDetails = async (colName) => {
    if (columnDetailsCache[colName]) return;
    if (!fileId) return;
    try {
      const data = await apiPost('/api/column-details', { file_id: fileId, column: colName });
      if (data.status === 'success') {
        setColumnDetailsCache(prev => ({ ...prev, [colName]: data }));
      }
    } catch (err) {
      console.error("Error fetching column details:", err);
    }
  };

  const handleFilterToggle = (colName) => {
    if (expandedFilterColumn === colName) {
      setExpandedFilterColumn(null);
    } else {
      setExpandedFilterColumn(colName);
      fetchColumnDetails(colName);
    }
  };

  const handleNumericFilterChange = (colName, field, value) => {
    const current = columnFilters[colName] || {};
    const newVal = value === '' ? undefined : Number(value);
    const updated = { ...current, [field]: newVal };
    if (updated.min === undefined && updated.max === undefined) {
      onColumnFilterChange(colName, null);
    } else {
      onColumnFilterChange(colName, { min: updated.min, max: updated.max });
    }
  };

  const handleCategoricalSelect = (colName, value) => {
    const current = columnFilters[colName] || {};
    const selected = current.selected || [];
    const details = columnDetailsCache[colName];
    const allValues = details?.values || [];
    let newSelected;
    if (selected.includes(value)) {
      newSelected = selected.filter(v => v !== value);
    } else {
      newSelected = [...selected, value];
    }
    if (newSelected.length === 0) {
      onColumnFilterChange(colName, null);
    } else {
      onColumnFilterChange(colName, { selected: newSelected });
    }
  };

  const selectAllCategorical = (colName) => {
    const details = columnDetailsCache[colName];
    if (!details) return;
    onColumnFilterChange(colName, { selected: [...details.values] });
  };

  const clearAllCategorical = (colName) => {
    onColumnFilterChange(colName, null);
  };

  const handleClearFilter = (colName) => {
    onColumnFilterChange(colName, null);
    setExpandedFilterColumn(null);
  };

  const baseFontOptions = fonts.map(f => ({
    value: f.font_family,
    label: `${f.name} (${f.category})`
  }));

  const allFontOptions = baseFontOptions;

  const renderFilterPanel = (colName) => {
    if (expandedFilterColumn !== colName) return null;
    const details = columnDetailsCache[colName];
    return (
      <div className="mx-2 mt-1 mb-2 p-3 bg-white border border-[#428177]/30 rounded-lg shadow-sm text-right">
        {details ? (
          <>
            {details.type === 'numeric' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] font-bold text-gray-500 block mb-0.5">من</label>
                    <input type="number"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                      placeholder={details.min?.toLocaleString()}
                      value={columnFilters[colName]?.min ?? ''}
                      onChange={(e) => handleNumericFilterChange(colName, 'min', e.target.value)} />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-bold text-gray-500 block mb-0.5">إلى</label>
                    <input type="number"
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
                      placeholder={details.max?.toLocaleString()}
                      value={columnFilters[colName]?.max ?? ''}
                      onChange={(e) => handleNumericFilterChange(colName, 'max', e.target.value)} />
                  </div>
                </div>
                <div className="text-[10px] text-gray-400">
                  المدى: {details.min?.toLocaleString()} – {details.max?.toLocaleString()}
                </div>
              </div>
            )}
            {details.type === 'categorical' && (
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-gray-500">{details.values.length} قيمة فريدة</span>
                  <div className="flex gap-2">
                    <button onClick={() => selectAllCategorical(colName)}
                      className="text-[10px] font-bold text-[#428177] hover:text-[#054239]">تحديد الكل</button>
                    <button onClick={() => clearAllCategorical(colName)}
                      className="text-[10px] font-bold text-gray-400 hover:text-red-500">إلغاء الكل</button>
                  </div>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1 custom-scrollbar border-t border-gray-100 pt-1">
                  {details.values.map(val => {
                    const isChecked = (columnFilters[colName]?.selected || []).includes(val);
                    return (
                      <label key={val} className="flex items-center gap-2 py-0.5 px-1 rounded hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox"
                          className="accent-[#054239]"
                          checked={isChecked}
                          onChange={() => handleCategoricalSelect(colName, val)} />
                        <span className="text-xs text-gray-700 truncate">{val}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="mt-2 flex justify-between">
              {columnFilters[colName] && (
                <button onClick={() => handleClearFilter(colName)}
                  className="text-[10px] text-red-400 hover:text-red-600 font-bold">إزالة الفلتر</button>
              )}
              <button onClick={() => setExpandedFilterColumn(null)}
                className="text-[10px] text-gray-400 hover:text-gray-600 font-bold mr-auto">إغلاق</button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center py-2">
            <div className="w-4 h-4 border-2 border-[#428177] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-80 bg-white border-l border-gray-200 shadow-sm flex flex-col p-4 pb-12 h-full overflow-y-auto">
      {!isAnalysisStarted ? (
        <div>
          <h2 className="font-bold text-[#054239] mb-4 flex items-center gap-2 border-b pb-2 text-base">
            <Layout className="w-5 h-5 text-[#428177]" /> أعمدة الملف المكتشفة
          </h2>
          <div className="space-y-2">
            {allColumns.map(col => (
              <div key={col.name}>
                <div className="p-2.5 bg-gray-50 border border-gray-100 rounded-lg flex justify-between items-center">
                  <div className="flex flex-col truncate max-w-[180px]">
                    <span className="font-medium text-[#002623] text-sm truncate">{col.name}</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">
                      {col.type === 'numeric' ? 'عددي' : col.type === 'categorical' ? 'تصنيفي' : col.type === 'date' ? 'تاريخ' : 'فريد'}
                    </span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold
                    ${col.type === 'numeric' ? 'bg-green-100 text-green-800' :
                      col.type === 'categorical' ? 'bg-[#054239]/10 text-[#054239]' :
                      col.type === 'date' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
                    {col.type === 'numeric' ? 'رقمي' : col.type === 'categorical' ? 'تصنيفي' : col.type === 'date' ? 'تاريخ' : 'فريد'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Column Management Section */}
          <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
            <h3 className="text-xs font-bold text-[#054239] flex items-center gap-1 border-b pb-1.5 mb-2">
              <Layout className="w-4 h-4 text-[#428177]" /> إدارة الأعمدة
            </h3>
            <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
              {allColumns.map(col => {
                const isDeleted = deletedColumnNames?.includes(col.name);
                return (
                  <div key={col.name}>
                    <div className={`p-1.5 rounded flex items-center justify-between group ${isDeleted ? 'bg-red-50/50 border border-red-100' : 'bg-gray-50 border border-gray-100'}`}>
                      <button
                        onClick={() => { if (!isDeleted) handleFilterToggle(col.name); }}
                        className={`flex flex-col truncate max-w-[140px] text-right ${isDeleted ? 'opacity-50 cursor-default' : 'cursor-pointer hover:text-[#428177]'}`}
                        title={isDeleted ? '' : 'انقر لتصفية هذا العمود'}
                      >
                        <span className={`text-xs font-medium truncate ${isDeleted ? 'text-gray-400 line-through' : 'text-[#002623]'}`}>{col.name}</span>
                        <span className="text-[9px] text-gray-400">
                          {col.type === 'numeric' ? 'عددي' : col.type === 'categorical' ? 'تصنيفي' : col.type === 'date' ? 'تاريخ' : 'فريد'}
                        </span>
                      </button>
                      <div className="flex items-center gap-1">
                        {col.type !== 'unique_id' && !isDeleted && (
                          <button onClick={(e) => { e.stopPropagation(); handleFilterToggle(col.name); }}
                            className={`p-1 rounded transition-all ${
                              columnFilters?.[col.name]
                                ? 'text-white bg-[#428177]'
                                : 'text-gray-400 hover:text-[#428177] hover:bg-[#428177]/10'
                            }`} title="تصفية">
                            <Filter className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {!isDeleted ? (
                          <button onClick={() => onDeleteColumn(col.name)}
                            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-all" title="استبعاد العمود">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button onClick={() => onRestoreColumn(col.name)}
                            className="p-1 text-[#428177] hover:text-[#054239] hover:bg-[#428177]/10 rounded transition-all" title="استعادة العمود">
                            <Undo2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {!isDeleted && renderFilterPanel(col.name)}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Filters Section */}
          {Object.keys(columnFilters || {}).length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <h3 className="text-xs font-bold text-amber-800 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" /> الفلاتر النشطة
              </h3>
              {Object.entries(columnFilters).map(([colName, config]) => {
                let desc = '';
                if (typeof config === 'object' && config !== null) {
                  if ('min' in config || 'max' in config) {
                    const min = config.min;
                    const max = config.max;
                    if (min != null && max != null) desc = `من ${min} إلى ${max}`;
                    else if (min != null) desc = `≥ ${min}`;
                    else if (max != null) desc = `≤ ${max}`;
                  } else if ('selected' in config) {
                    desc = `${config.selected.length} قيم محددة`;
                  }
                }
                return (
                  <div key={colName} className="flex justify-between items-center bg-white p-2 rounded border border-amber-100">
                    <span className="text-xs font-bold text-gray-700 truncate max-w-[120px]">{colName}</span>
                    <span className="text-[10px] text-gray-500 mx-1 truncate max-w-[80px]">{desc}</span>
                    <button
                      onClick={() => handleClearFilter(colName)}
                      className="text-red-400 hover:text-red-600 text-xs shrink-0"
                      title="إزالة الفلتر"
                    >✕</button>
                  </div>
                );
              })}
            </div>
          )}

          <h2 className="font-bold text-[#054239] border-b pb-2 flex items-center gap-2 text-base">
            <Palette className="w-5 h-5 text-[#8e7b5b]" /> إعدادات وتخصيص المخطط
          </h2>

          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 block">المحور الأساسي (X)</label>
            <select className="w-full border rounded-lg p-2 text-sm bg-white border-gray-300 focus:border-[#054239]" value={selectedX} onChange={(e) => setSelectedX(e.target.value)}>
              <option value="">-- اختر العمود --</option>
              {allColumns.filter(c => c.type !== 'unique_id' && !(deletedColumnNames || []).includes(c.name)).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 block">محور التقاطع الحسابي (Y) - اختياري</label>
            <select className="w-full border rounded-lg p-2 text-sm bg-white border-gray-300" value={selectedY} onChange={(e) => setSelectedY(e.target.value)}>
              <option value="">-- حساب التكرار التلقائي --</option>
              {allColumns.filter(c => c.type === 'numeric' && !(deletedColumnNames || []).includes(c.name)).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 block">نوع المخطط المتوافق</label>
            <select className="w-full border rounded-lg p-2 text-sm bg-white border-gray-300" value={chartType} onChange={(e) => setChartType(e.target.value)}>
              {compatibleCharts.map(ch => <option key={ch.value} value={ch.value}>{ch.label}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 block">عنوان المخطط</label>
            <input type="text" className="w-full border rounded-lg p-2 text-sm border-gray-300" placeholder="اكتب عنواناً..." value={chartTitle} onChange={(e) => setChartTitle(e.target.value)} />
          </div>

          <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 space-y-2">
            <label className="text-xs font-bold text-[#054239] flex items-center gap-1"><Palette className="w-4 h-4" /> نظام تلوين الأقسام والأعمدة</label>
            <div className="grid grid-cols-3 gap-1">
              <button type="button" onClick={() => setColorMode('single')} className={`py-1 text-[10px] font-bold rounded border ${colorMode === 'single' ? 'bg-[#054239] text-white' : 'bg-white text-gray-600'}`}>لون موحد</button>
              <button type="button" onClick={() => setColorMode('multi')} className={`py-1 text-[10px] font-bold rounded border ${colorMode === 'multi' ? 'bg-[#054239] text-white' : 'bg-white text-gray-600'}`}>أوتوماتيكي</button>
              <button type="button" onClick={() => setColorMode('manual')} className={`py-1 text-[10px] font-bold rounded border ${colorMode === 'manual' ? 'bg-[#054239] text-white' : 'bg-white text-gray-600'}`}>بيدي 🎨</button>
            </div>

            {colorMode === 'single' && (
              <div className="flex gap-2 items-center mt-2">
                <input type="color" className="w-10 h-8 border rounded cursor-pointer" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} />
                <span className="text-xs text-gray-700 uppercase font-mono font-bold">{themeColor}</span>
              </div>
            )}

            {colorMode === 'manual' && uniqueCategories.length > 0 && (
              <div className="mt-2 space-y-2 max-h-40 overflow-y-auto border-t pt-2 custom-scrollbar">
                <label className="text-[11px] font-bold text-gray-500 block mb-1">اختر لون كل قسم بيدك:</label>
                {uniqueCategories.map(cat => (
                  <div key={cat} className="flex items-center justify-between bg-white p-1.5 rounded border border-gray-200">
                    <span className="text-xs font-medium text-gray-700 truncate max-w-[140px]">{cat}</span>
                    <input type="color" className="w-8 h-6 border rounded cursor-pointer"
                      value={(customCategoryColors && customCategoryColors[cat]) || '#428177'}
                      onChange={(e) => handleColorChange(cat, e.target.value)} />
                  </div>
                ))}
              </div>
            )}
            {colorMode === 'manual' && !selectedX && (
              <span className="text-[11px] text-amber-600 block mt-1">يرجى اختيار المحور الأساسي X أولاً لتعديل ألوانه.</span>
            )}
          </div>

          <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 space-y-3">
            <label className="text-xs font-bold text-[#054239] flex items-center gap-1"><Sliders className="w-4 h-4" /> الخط والأبعاد الهندسية</label>

            <div className="space-y-1">
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-bold text-gray-500 block">نوع الخط العربي/العالمي</label>
                <button type="button" onClick={() => setShowFontManager(true)}
                  className="text-[10px] font-bold text-[#428177] hover:text-[#054239] flex items-center gap-0.5">
                  <Plus className="w-3 h-3" /> إدارة الخطوط
                </button>
              </div>

              {showFontManager && (
                <FontManager
                  isAdmin={false}
                  onFontAdded={onFontAdded}
                  onClose={() => setShowFontManager(false)}
                />
              )}

              <select className="w-full border rounded-md p-1.5 text-xs bg-white border-gray-300" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
                {allFontOptions.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold text-gray-500 block">حجم الخط الأساسي ({fontSize}px)</label>
              <input type="range" min="10" max="22" className="w-full accent-[#054239]" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500 block">العرض الكلي</label>
                <select className="w-full border rounded-md p-1.5 text-xs bg-white border-gray-300" value={chartWidth} onChange={(e) => setChartWidth(e.target.value)}>
                  <option value="w-full">كامل (100%)</option>
                  <option value="md:col-span-1">نصف المساحة</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500 block">الارتفاع المكتبي</label>
                <select className="w-full border rounded-md p-1.5 text-xs bg-white border-gray-300" value={chartHeight} onChange={(e) => setChartHeight(e.target.value)}>
                  <option value="250px">قصير (250px)</option>
                  <option value="350px">متوسط (350px)</option>
                  <option value="450px">طويل (450px)</option>
                </select>
              </div>
            </div>

            {(chartType === 'bar' || chartType === 'horizontal_bar') && (
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500 block">سماكة الأعمدة البيانية ({barWidth}%)</label>
                <input type="range" min="10" max="90" step="5" className="w-full accent-[#428177]" value={barWidth} onChange={(e) => setBarWidth(parseInt(e.target.value))} />
              </div>
            )}
          </div>

          <button type="button" onClick={onAddChart}
              className="w-full bg-[#054239]  hover:bg-[#002623] text-white text-sm font-bold py-2.5 rounded-lg transition-colors shadow-sm mt-2">
              ➕ إضافة المخطط إلى اللوحة
            </button>
        </div>

      )}
    </aside>
  );
}