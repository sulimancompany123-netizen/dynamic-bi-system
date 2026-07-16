import React, { useState, useEffect } from 'react';
import { Palette, Sliders, Plus, Check, X } from 'lucide-react';
import { apiGet } from '../api';

export default function ChartEditModal({ chart, allColumns, onSave, onCancel, fonts, fileId, onFontAdded }) {
  const [selectedX, setSelectedX] = useState('');
  const [selectedY, setSelectedY] = useState('');
  const [chartType, setChartType] = useState('bar');
  const [chartTitle, setChartTitle] = useState('');
  const [themeColor, setThemeColor] = useState('#054239');
  const [fontSize, setFontSize] = useState(14);
  const [fontFamily, setFontFamily] = useState('Cairo, sans-serif');
  const [chartWidth, setChartWidth] = useState('md:col-span-1');
  const [chartHeight, setChartHeight] = useState('350px');
  const [barWidth, setBarWidth] = useState(50);
  const [colorMode, setColorMode] = useState('single');
  const [customCategoryColors, setCustomCategoryColors] = useState({});
  const [uniqueCategories, setUniqueCategories] = useState([]);
  const [showFontInput, setShowFontInput] = useState(false);
  const [newFontName, setNewFontName] = useState('');

  useEffect(() => {
    if (chart) {
      setSelectedX(chart.x || '');
      setSelectedY(chart.y || '');
      setChartType(chart.type || 'bar');
      setChartTitle(chart.title || '');
      setThemeColor(chart.themeColor || '#054239');
      setFontSize(chart.fontSize || 14);
      setFontFamily(chart.fontFamily || 'Cairo, sans-serif');
      setChartWidth(chart.chartWidth || 'md:col-span-1');
      setChartHeight(chart.chartHeight || '350px');
      setBarWidth(chart.barWidth || 50);
      setColorMode(chart.colorMode || 'single');
      setCustomCategoryColors(chart.customCategoryColors || {});
    }
  }, [chart?.id]);

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

  const getCompatibleCharts = () => {
    if (!selectedX) return [];
    const colX = allColumns.find(c => c.name === selectedX);
    const colY = allColumns.find(c => c.name === selectedY);
    if (!selectedY) {
      return [
        { value: 'bar', label: 'مخطط أعمدة' },
        { value: 'horizontal_bar', label: 'أعمدة أفقي' },
        { value: 'pie', label: 'دائري (Pie)' },
        { value: 'donut', label: 'حلقة (Donut)' },
        { value: 'polarBar', label: 'أعمدة قطبي' },
        { value: 'funnel', label: 'قمعي (Funnel)' },
        { value: 'treemap', label: 'Treemap' },
        { value: 'sunburst', label: 'Sunburst' },
        { value: 'line', label: 'خطي' },
        { value: 'area', label: 'مساحي' },
      ];
    }
    if (colX?.type === 'numeric' && colY?.type === 'numeric') {
      return [
        { value: 'scatter', label: 'مبعثر (Scatter)' },
        { value: 'line', label: 'خطي' },
        { value: 'bar', label: 'أعمدة' },
        { value: 'area', label: 'مساحي' },
      ];
    }
    if (colX?.type === 'categorical' && colY?.type === 'numeric') {
      return [
        { value: 'bar', label: 'أعمدة رأسي' },
        { value: 'horizontal_bar', label: 'أعمدة أفقي' },
        { value: 'pie', label: 'دائري' },
        { value: 'line', label: 'خطي' },
        { value: 'area', label: 'مساحي' },
        { value: 'scatter', label: 'مبعثر' },
        { value: 'polarBar', label: 'أعمدة قطبي' },
        { value: 'funnel', label: 'قمعي (Funnel)' },
      ];
    }
    if (colX?.type === 'date' && colY?.type === 'numeric') {
      return [
        { value: 'line', label: 'خطي زمني' },
        { value: 'area', label: 'مساحي' },
        { value: 'bar', label: 'أعمدة' },
        { value: 'scatter', label: 'مبعثر' },
      ];
    }
    return [{ value: 'bar', label: 'مخطط عام' }];
  };

  const handleColorChange = (category, color) => {
    setCustomCategoryColors(prev => ({ ...prev, [category]: color }));
  };

  const handleSaveCustomFont = async () => {
    const trimmedName = newFontName.trim();
    if (!trimmedName) return alert('يرجى كتابة اسم الخط أولاً');
    const fontValue = `${trimmedName}, sans-serif`;
    try {
      const { apiPost } = await import('../api')
      const res = await apiPost('/api/fonts', { name: trimmedName, font_family: fontValue, category: 'sans-serif' })
      if (res.status === 'success') {
        const id = `font-link-${trimmedName.toLowerCase().replace(/\s+/g, '-')}`
        if (!document.getElementById(id)) {
          const link = document.createElement('link')
          link.id = id
          link.rel = 'stylesheet'
          link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(trimmedName)}:wght@400;700&display=swap`
          document.head.appendChild(link)
        }
        setFontFamily(fontValue)
        setNewFontName('')
        setShowFontInput(false)
        onFontAdded?.()
      }
    } catch (err) {
      alert(err.message || 'فشل إضافة الخط')
    }
  };

  const baseFontOptions = fonts.map(f => ({
    value: f.font_family,
    label: `${f.name} (${f.category})`
  }));

  const allFontOptions = baseFontOptions;
  const compatibleCharts = getCompatibleCharts();

  const handleSave = () => {
    onSave(chart.id, {
      x: selectedX,
      y: selectedY,
      type: chartType,
      title: chartTitle,
      themeColor,
      fontSize,
      fontFamily,
      chartWidth,
      chartHeight,
      barWidth,
      colorMode,
      customCategoryColors: colorMode === 'manual' ? { ...customCategoryColors } : null
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[600px] max-h-[85vh] overflow-y-auto mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center z-10">
          <h2 className="font-bold text-[#054239] text-base flex items-center gap-2">
            <Palette className="w-5 h-5 text-[#8e7b5b]" /> 🔧 تعديل خصائص المخطط
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 block">المحور الأساسي (X)</label>
            <select className="w-full border rounded-lg p-2 text-sm bg-white border-gray-300 focus:border-[#054239]" value={selectedX} onChange={(e) => setSelectedX(e.target.value)}>
              <option value="">-- اختر العمود --</option>
              {allColumns.filter(c => c.type !== 'unique_id').map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-600 block">محور التقاطع الحسابي (Y) - اختياري</label>
            <select className="w-full border rounded-lg p-2 text-sm bg-white border-gray-300" value={selectedY} onChange={(e) => setSelectedY(e.target.value)}>
              <option value="">-- حساب التكرار التلقائي --</option>
              {allColumns.filter(c => c.type === 'numeric').map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
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
                <button type="button" onClick={() => setShowFontInput(!showFontInput)}
                  className="text-[10px] font-bold text-[#428177] hover:text-[#054239] flex items-center gap-0.5">
                  <Plus className="w-3 h-3" /> خط من Google؟
                </button>
              </div>

              {showFontInput ? (
                <div className="flex gap-1 mb-2 bg-white p-1.5 rounded border border-gray-200 shadow-inner">
                  <input type="text" className="flex-1 text-xs p-1 border rounded bg-gray-50 font-mono"
                    placeholder="مثال: Amiri أو Changa" value={newFontName}
                    onChange={(e) => setNewFontName(e.target.value)} />
                  <button type="button" onClick={handleSaveCustomFont}
                    className="p-1 bg-[#054239] text-white rounded hover:bg-[#002623]" title="حفظ الخط وتطبيقه">
                    <Check className="w-3 h-3" />
                  </button>
                </div>
              ) : null}

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
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4 flex gap-2">
          <button type="button" onClick={handleSave}
            className="flex-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold py-2.5 rounded-lg transition-colors shadow-sm">
            💾 حفظ التعديلات
          </button>
          <button type="button" onClick={onCancel}
            className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-bold py-2.5 rounded-lg transition-colors">
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}