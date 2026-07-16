import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { Trash2, Edit2 } from 'lucide-react';

// Work out label rotation/wrapping, grid margins and the container height needed so that
// every category name / slice name is fully visible (no hover, no clipping) for any chart
// type and any name length. Shared by buildOptions (axis/grid/labels) and the render height.
function computeLayout(chart, data) {
  const isItem = ['pie', 'donut', 'funnel'].includes(chart.type);
  const isHierarchy = ['treemap', 'sunburst'].includes(chart.type);
  const isPolar = chart.type === 'polarBar';
  const isAxis = !isItem && !isHierarchy && !isPolar;
  const isHorizontal = chart.type === 'horizontal_bar';

  const labels = (data?.x_data || []).map(v => String(v ?? ''));
  const maxLabelLen = labels.reduce((m, s) => Math.max(m, s.length), 0);
  const count = labels.length;
  const fontFamily = chart.fontFamily || 'Cairo, sans-serif';
  const labelFontSize = chart.fontSize ? Math.max(10, chart.fontSize - 2) : 12;

  // Wrap long names so each line stays narrow; rotation is driven by how MANY categories
  // compete for horizontal space (not by name length, which wrapping + height handle).
  const wrapChars = 14;
  const wrapLines = Math.max(1, Math.ceil(maxLabelLen / wrapChars));
  const lineLen = Math.min(maxLabelLen, wrapChars);
  const labelRotate = (isAxis && !isHorizontal && maxLabelLen > 4)
    ? (count > 10 ? 55 : count > 6 ? 40 : 28)
    : 0;

  const charPx = labelFontSize * 0.6;
  const lineHeight = labelFontSize + 4;
  const topMargin = 50; // ChartView always renders a title
  const rad = labelRotate * Math.PI / 180;
  const labelBoxW = lineLen * charPx;
  const labelBoxH = wrapLines * lineHeight;
  const rotatedH = labelRotate ? Math.sin(rad) * labelBoxW + Math.cos(rad) * labelBoxH : labelBoxH;
  const gridBottom = (isAxis && !isHorizontal) ? Math.min(Math.round(rotatedH) + 20, 300) : 24;

  const userH = parseInt(String(chart.chartHeight || '').replace(/[^\d]/g, ''), 10) || 0;
  let chartHeight;
  if (isAxis && !isHorizontal) {
    chartHeight = Math.min(topMargin + 200 + gridBottom, 720);
  } else if (isHorizontal) {
    chartHeight = Math.min(Math.max(240, count * 28 + topMargin + 24), 720);
  } else {
    chartHeight = isItem ? 360 : 320;
  }
  chartHeight = Math.max(chartHeight, userH);

  return { isItem, isHierarchy, isPolar, isAxis, isHorizontal, count, fontFamily, labelFontSize, labelRotate, gridBottom, topMargin, chartHeight, wrapChars };
}

// Break a label into lines no wider than wrapChars (split on spaces, hard-break long words).
function makeWrapLabel(wrapChars) {
  return (s) => {
    s = String(s ?? '');
    if (s.length <= wrapChars) return s;
    const out = [];
    let line = '';
    for (let word of s.split(' ')) {
      while (word.length > wrapChars) {
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, wrapChars));
        word = word.slice(wrapChars);
      }
      if (!line) line = word;
      else if ((line + ' ' + word).length <= wrapChars) line += ' ' + word;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
    return out.join('\n');
  };
}

export default function ChartView({ chart, chartData, currentFilters, globalFilters, onChartClick, onDelete, onEdit, token, fileId, readOnly = false }) {
  const [chartOptions, setChartOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const dataAttemptedRef = useRef(false);

  const chartKey = JSON.stringify({
    x: chart.x, y: chart.y, type: chart.type, title: chart.title,
    themeColor: chart.themeColor, fontSize: chart.fontSize, fontFamily: chart.fontFamily,
    chartWidth: chart.chartWidth, chartHeight: chart.chartHeight, barWidth: chart.barWidth,
    colorMode: chart.colorMode, customCategoryColors: chart.customCategoryColors
  });

  const buildOptions = (data) => {
    const layout = computeLayout(chart, data);
    const { isItem, isHierarchy, isPolar, isAxis, isHorizontal, fontFamily, labelFontSize, labelRotate, gridBottom, topMargin, wrapChars } = layout;
    const wrapLabel = makeWrapLabel(wrapChars);

    const getEChartsType = () => {
      if (chart.type === 'area') return 'line';
      if (chart.type === 'polarBar') return 'bar';
      if (chart.type === 'horizontal_bar') return 'bar';
      if (chart.type === 'donut') return 'pie'; // a donut is a pie with an inner radius
      return chart.type;
    };

    const buildAxisSeriesData = () => {
      if (chart.colorMode === 'manual' && chart.customCategoryColors) {
        return data.y_data.map((val, idx) => {
          const categoryName = data.x_data[idx];
          const chosenColor = chart.customCategoryColors[categoryName] || chart.themeColor;
          return { value: val, itemStyle: { color: chosenColor } };
        });
      }
      if (chart.colorMode === 'multi') {
        const predefinedColors = ['#054239', '#428177', '#8e7b5b', '#988561', '#1f5f54', '#b5a484'];
        return data.y_data.map((val, idx) => ({
          value: val,
          itemStyle: { color: predefinedColors[idx % predefinedColors.length] }
        }));
      }
      return data.y_data;
    };

    const buildItemSeriesData = () => {
      return data.x_data.map((name, i) => {
        let itemColor = undefined;
        if (chart.colorMode === 'manual' && chart.customCategoryColors) {
          itemColor = chart.customCategoryColors[name];
        }
        return { name, value: data.y_data[i], itemStyle: itemColor ? { color: itemColor } : undefined };
      });
    };

    const seriesData = (isItem || isHierarchy) ? buildItemSeriesData() : buildAxisSeriesData();

    const series = {
      name: data.series_name,
      type: getEChartsType(),
      data: seriesData,
      ...(chart.type === 'area' && { areaStyle: { color: '#8e7b5b' }, smooth: true }),
      ...(chart.type === 'line' && { smooth: true }),
      ...(chart.type === 'scatter' && { symbolSize: 12 }),
      ...(chart.type === 'funnel' && { sort: 'descending', gap: 2 }),
      ...(chart.type === 'treemap' && { roam: false }),
      ...(isPolar && { coordinateSystem: 'polar' }),
      ...(isAxis && { barWidth: chart.barWidth ? `${chart.barWidth}%` : '50%' }),
      // Show the value on/next to each bar.
      ...(['bar', 'horizontal_bar'].includes(chart.type) && {
        label: {
          show: true,
          position: chart.type === 'horizontal_bar' ? 'right' : 'top',
          fontFamily, fontSize: labelFontSize, color: '#002623',
        }
      }),
      // Line/area: show the value above each point.
      ...(['line', 'area'].includes(chart.type) && {
        label: {
          show: true,
          position: 'top',
          fontFamily, fontSize: labelFontSize, color: '#002623',
        }
      }),
      ...(chart.type === 'donut' && { radius: ['38%', '62%'] }),
      ...(chart.type === 'pie' && { radius: '62%' }),
      ...(chart.type === 'funnel' && { radius: '70%' }),
      ...(isAxis && {
        itemStyle: {
          color: chart.colorMode === 'single' ? chart.themeColor : undefined,
          borderRadius: ['bar', 'horizontal_bar'].includes(chart.type) ? [4, 4, 0, 0] : undefined
        }
      }),
      ...((isItem || isHierarchy) && {
        itemStyle: {
          color: chart.colorMode === 'single' ? chart.themeColor : undefined
        }
      }),
      // Pie/donut/funnel: keep slice names permanently visible (no hover needed).
      ...(isItem && {
        label: {
          show: true,
          position: chart.type === 'funnel' ? 'inside' : 'outside',
          formatter: chart.type === 'funnel' ? '{b}' : '{b}: {d}%',
          fontFamily, fontSize: labelFontSize, color: '#002623',
          ...(chart.type !== 'funnel' && { width: 110, overflow: 'break', lineHeight: labelFontSize + 4 }),
        },
        ...(chart.type !== 'funnel' && { labelLine: { show: true, length: 12, length2: 10 } }),
        avoidLabelOverlap: true,
      }),
      // Treemap/sunburst: show the name AND the value (row count) inside each piece.
      ...(isHierarchy && {
        label: { show: true, fontFamily, fontSize: labelFontSize, color: '#fff', overflow: 'break', formatter: '{b}\n{c}' },
      }),
    };

    // Category axis labels: show all (interval 0), rotate by category count, wrap long names.
    const categoryAxisLabel = {
      interval: 0,
      rotate: labelRotate,
      hideOverlap: false,
      margin: 14, // push names down so long, rotated labels don't sit on top of the bars
      verticalAlign: 'top',
      fontFamily,
      fontSize: labelFontSize,
      lineHeight: labelFontSize + 4,
      color: '#002623',
      formatter: wrapLabel,
    };

    const option = {
      title: {
        text: chart.title || `${chart.x} Analysis`,
        left: 'center',
        textStyle: { fontSize: chart.fontSize, color: '#002623', fontFamily: chart.fontFamily }
      },
      textStyle: { fontFamily: chart.fontFamily },
      tooltip: { trigger: (isItem || isHierarchy) ? 'item' : 'axis' },
      grid: isAxis ? { left: '3%', right: '5%', bottom: gridBottom, top: topMargin, containLabel: true } : undefined,
      xAxis: isAxis ? (isHorizontal
        ? { type: 'value' }
        : { type: 'category', data: data.x_data, axisLabel: categoryAxisLabel })
        : undefined,
      yAxis: isAxis ? (isHorizontal
        // Keep each category name on a single line (no width/break wrapping); containLabel
        // reserves whatever horizontal room the full name needs, so labels never stack.
        ? { type: 'category', data: data.x_data, axisLabel: { interval: 0, hideOverlap: false, overflow: 'none', fontFamily, color: '#002623' } }
        : { type: 'value' })
        : undefined,
      polar: isPolar ? {} : undefined,
      angleAxis: isPolar ? { type: 'category', data: data.x_data, axisLabel: { interval: 0, hideOverlap: false, fontFamily } } : undefined,
      radiusAxis: isPolar ? {} : undefined,
      series: [series]
    };

    setChartOptions(option);
    setLoading(false);
  };

  useEffect(() => {
    if (chartData !== undefined) {
      dataAttemptedRef.current = true;
    }
    if (chartData) {
      buildOptions(chartData);
    }
  }, [chartData, chartKey]);

  if (chartData === undefined) {
    return <div className="h-[300px] flex items-center justify-center text-sm font-bold text-[#428177]">جاري تحليل واستدعاء البيانات الفلكية...</div>;
  }

  if (chartData === null && dataAttemptedRef.current && loading) {
    return (
      <div className={`bg-white border border-gray-200 rounded-xl p-4 shadow-sm ${chart.chartWidth === 'w-full' ? 'col-span-1 md:col-span-2' : 'col-span-1'}`}>
        <div className="h-[300px] flex items-center justify-center text-sm text-gray-400">لم يتم تحميل البيانات</div>
      </div>
    );
  }

  const containerClass = chart.chartWidth === 'w-full' ? 'col-span-1 md:col-span-2' : 'col-span-1';

  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-4 shadow-sm relative hover:shadow-md transition-shadow ${containerClass}`}>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <button onClick={onEdit} className="p-1 text-gray-400 hover:text-amber-600 transition-colors" title="تعديل خصائص المخطط">
            <Edit2 className="w-4 h-4" />
          </button>
          <button onClick={() => onDelete(chart.id)} className="p-1 text-gray-400 hover:text-red-500 transition-colors" title="حذف">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="mt-4">
        {chartOptions && (
          <ReactECharts
            option={chartOptions}
            style={{ height: `${computeLayout(chart, chartData).chartHeight}px`, width: '100%' }}
            onEvents={readOnly ? {} : { 'click': (params) => onChartClick(params, chart) }}
          />
        )}
      </div>
    </div>
  );
}