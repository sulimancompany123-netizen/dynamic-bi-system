import { Node, mergeAttributes } from '@tiptap/core'
import React from 'react'
import ReactDOM from 'react-dom/client'
import ReactECharts from 'echarts-for-react'
import { hexToRgba } from '../lib/reportBackgrounds'

// Session-level caches shared by every chart node in the app:
// - chartDataCache: the expensive /api/chart-data result, keyed by file+columns.
//   Reused across charts and re-opens so a report doesn't re-query the backend
//   for every chart each time it loads. The "تحديث البيانات" button bypasses it.
// - treeConfigInflight: dedupes concurrent /api/global-chart-trees requests so all
//   charts sharing one tree make a single network call, while still re-fetching
//   fresh on the next report open (entries are removed once the request settles).
const chartDataCache = new Map()
const treeConfigInflight = new Map()
// Per-tree reconstruction of levelId -> filter for legacy drilled charts that never persisted
// their own `filter`. Computed once per tree per session (the promise is cached).
const treeFilterReconCache = new Map()

// Drop cached chart data so charts refetch fresh from the backend. Call after a file's data
// changes (e.g. an Excel replace): the backend keeps the same file_id and columns, so the
// cacheKey (fileId|x|y|filters) is unchanged and the stale entry would otherwise be reused —
// this is why a replaced file shows new numbers on the chart page but old ones in reports.
// Pass a fileId to clear only that file's entries, or nothing to clear everything.
export const clearChartDataCache = (fileId = null) => {
  if (fileId == null) {
    chartDataCache.clear()
  } else {
    const prefix = `${fileId}|`
    for (const key of chartDataCache.keys()) {
      if (key.startsWith(prefix)) chartDataCache.delete(key)
    }
  }
  // Reconstructed drill filters depend on the file's column values, so drop them too.
  treeFilterReconCache.clear()
}

// Registry of every currently-mounted chart node's last-rendered ECharts option, so the Word
// export can re-render the exact same chart (same data, filters and styling) to editable SVG.
// Keyed by a per-node id; `pos` gives document order. Entries are removed when the node unmounts.
export const chartExportRegistry = new Map()
let chartExportKeySeq = 0

const fetchTreeConfig = async (treeId) => {
  if (treeConfigInflight.has(treeId)) return treeConfigInflight.get(treeId)
  const p = (async () => {
    const { apiGet } = await import('../api')
    return apiGet(`/api/global-chart-trees/${treeId}`)
  })()
  treeConfigInflight.set(treeId, p)
  try {
    return await p
  } finally {
    treeConfigInflight.delete(treeId)
  }
}

// The id the app assigns to a drill-down level: a hash of the level's filter object. Must stay
// identical to the formula in App.jsx onChartClick so reconstruction below matches.
const levelHashOf = (filterObj) =>
  `level_${Array.from(JSON.stringify(filterObj)).reduce((acc, ch) => ((acc << 5) - acc) + ch.charCodeAt(0) | 0, 0)}`

// Recover the drill filter for legacy charts that stored only a `levelId` (a hash of the filter)
// without the filter itself, and whose breadcrumb is no longer saved in the tree. We brute-force
// column/value combinations — the drill columns are the charts' x-axes — against the same hash.
// Returns a Map<levelId, filterObject>. Cached per tree.
const reconstructTreeFilters = (treeId, structure, fileId) => {
  if (treeFilterReconCache.has(treeId)) return treeFilterReconCache.get(treeId)
  const p = (async () => {
    const result = new Map()
    const charts = structure?.charts || []
    const needing = charts.filter(c => c.levelId && c.levelId !== 'root' && (!c.filter || !Object.keys(c.filter).length))
    if (!needing.length || !fileId) return result
    const neededIds = new Set(needing.map(c => c.levelId))
    const candidateCols = [...new Set(charts.map(c => c.x).filter(Boolean))]

    const { apiGet } = await import('../api')
    const colValues = {}
    await Promise.all(candidateCols.map(async (col) => {
      try {
        const data = await apiGet('/api/column-categories', { file_id: fileId, column: col })
        colValues[col] = data.categories || []
      } catch { colValues[col] = [] }
    }))

    // Drilling trims values and coerces numeric ones to Number; we don't know column types here,
    // so try the trimmed string AND (when it looks numeric) the Number form so hashes match.
    const seen = new Set([levelHashOf({})])
    const queue = [{ filter: {}, depth: 0 }]
    const MAX_DEPTH = 3, ITER_CAP = 300000
    let iters = 0
    const tryVal = (base, col, v, depth) => {
      const candidate = { ...base, [col]: v }
      const h = levelHashOf(candidate)
      if (seen.has(h)) return
      seen.add(h)
      if (neededIds.has(h)) result.set(h, candidate)
      queue.push({ filter: candidate, depth: depth + 1 })
    }
    while (queue.length && result.size < neededIds.size && iters < ITER_CAP) {
      const { filter: base, depth } = queue.shift()
      if (depth >= MAX_DEPTH) continue
      for (const col of candidateCols) {
        if (col in base) continue
        for (const rawV of (colValues[col] || [])) {
          iters++
          const s = String(rawV ?? '').trim()
          tryVal(base, col, s, depth)
          if (s !== '' && !isNaN(Number(s))) tryVal(base, col, Number(s), depth)
        }
      }
    }
    return result
  })()
  treeFilterReconCache.set(treeId, p)
  return p
}

const ChartNode = Node.create({
  name: 'chartNode',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      chartTreeId: { default: null },
      chartId: { default: null },
      fileId: { default: null },
      chartConfig: { default: null },
      // User-controlled box size (px) set by dragging the resize handle, like images.
      // null = auto: full content width and label-derived height.
      width: { default: null },
      height: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-chart-node]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-chart-node': '' })]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const container = document.createElement('div')
      container.contentEditable = 'false'
      container.className = 'chart-node-wrapper relative my-4 border border-gray-200 rounded-xl p-2 bg-white'
      container.setAttribute('data-chart-node', '')
      // Apply a user-set width (centered when narrower than the page); auto otherwise.
      if (node.attrs.width) {
        container.style.width = node.attrs.width + 'px'
        container.style.maxWidth = '100%'
        container.style.marginLeft = 'auto'
        container.style.marginRight = 'auto'
      }

      // Apply the user-chosen component background color + opacity (behind the chart). A null
      // color leaves the default white card; opacity 0 makes it fully transparent.
      const applyContainerBg = (cfg) => {
        const c = cfg || {}
        if (c.bgColor) {
          container.classList.remove('bg-white')
          container.style.backgroundColor = hexToRgba(c.bgColor, c.bgOpacity == null ? 1 : c.bgOpacity)
        } else {
          container.classList.add('bg-white')
          container.style.backgroundColor = ''
        }
      }
      applyContainerBg(node.attrs.chartConfig)

      const chartArea = document.createElement('div')
      chartArea.className = 'chart-node-area w-full'
      container.appendChild(chartArea)

      // Drag-to-resize handle (bottom-right), mirroring images: drag inward to shrink.
      const resizeHandle = document.createElement('div')
      resizeHandle.className = 'chart-resize-handle'
      resizeHandle.title = 'تغيير حجم المخطط'
      container.appendChild(resizeHandle)

      const editBtn = document.createElement('button')
      editBtn.className = 'chart-edit-btn absolute top-2 left-2 bg-[#054239] text-white text-xs px-2 py-1 rounded-lg opacity-0 transition-opacity z-10'
      editBtn.textContent = 'تخصيص'
      container.appendChild(editBtn)

      const ctxPanel = document.createElement('div')
      ctxPanel.className = 'chart-ctx-panel hidden absolute top-10 left-2 bg-white border border-gray-200 rounded-xl shadow-lg p-3 z-20 w-64 max-h-[70vh] overflow-y-auto'
      ctxPanel.innerHTML = `
        <div class="text-xs font-bold text-[#054239] mb-2">تخصيص المخطط</div>
        <label class="text-xs block mb-1">لون التعبئة</label>
        <input type="color" class="fill-color w-full h-8 rounded border mb-2 cursor-pointer">
        <label class="text-xs block mb-1">لون الحدود</label>
        <input type="color" class="stroke-color w-full h-8 rounded border mb-2 cursor-pointer">
        <label class="text-xs block mb-1">سمك الحدود</label>
        <input type="range" class="stroke-width w-full mb-2" min="0" max="5" step="0.5">
        <label class="text-xs block mb-1">حجم الخط</label>
        <input type="range" class="font-size-range w-full mb-2" min="10" max="22" step="1">
        <label class="text-xs block mb-1">لون العنوان</label>
        <input type="color" class="title-color w-full h-8 rounded border mb-2 cursor-pointer">
        <label class="text-xs block mb-1">لون البيانات</label>
        <input type="color" class="data-color w-full h-8 rounded border mb-2 cursor-pointer">
        <label class="text-xs block mb-1">لون خلفية المخطط</label>
        <div class="flex items-center gap-2 mb-2">
          <input type="color" class="comp-bg-color flex-1 h-8 rounded border cursor-pointer">
          <button class="comp-bg-clear text-[11px] text-gray-500 hover:text-red-500">بدون</button>
        </div>
        <label class="text-xs block mb-1">شفافية الخلفية: <span class="comp-bg-opacity-val">100%</span></label>
        <input type="range" class="comp-bg-opacity w-full mb-2" min="0" max="100" step="5">
        <button class="apply-btn bg-[#054239] text-white text-xs px-3 py-1.5 rounded-lg w-full font-bold mb-2">تطبيق</button>
        <button class="sync-btn bg-[#988561] text-white text-xs px-3 py-1.5 rounded-lg w-full font-bold mb-2">مزامنة من الشجرة</button>
        <button class="refresh-btn bg-[#428177] text-white text-xs px-3 py-1.5 rounded-lg w-full font-bold">تحديث البيانات</button>
      `
      container.appendChild(ctxPanel)

      let editOpen = false
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        editOpen = !editOpen
        ctxPanel.classList.toggle('hidden', !editOpen)
      })

      let chartRoot = null
      let localChartData = null
      let syncedConfig = null
      let fetching = false
      const exportKey = ++chartExportKeySeq
      // Tag the graphic area so the PDF export can find this chart's registered ECharts
      // option (in chartExportRegistry) and re-render it as crisp vector SVG.
      chartArea.setAttribute('data-chart-export-key', String(exportKey))

      // Work out everything that depends on how long the category names are: how far to
      // rotate axis labels, how much bottom/side room they need, and how tall the chart
      // container must be so nothing is clipped. Shared by both buildEChartsOption (axis,
      // grid, labels) and renderChart (container height).
      const computeLayout = (config, data) => {
        const isItem = ['pie', 'donut', 'funnel'].includes(config.type)
        const isHierarchy = ['treemap', 'sunburst'].includes(config.type)
        const isPolar = config.type === 'polarBar'
        const isAxis = !isItem && !isHierarchy && !isPolar
        const isHorizontal = config.type === 'horizontal_bar'

        const labels = (data?.x_data || []).map(v => String(v ?? ''))
        const maxLabelLen = labels.reduce((m, s) => Math.max(m, s.length), 0)
        const count = labels.length
        const fontFamily = config.fontFamily || 'Cairo, sans-serif'
        const labelFontSize = config.fontSize ? Math.max(10, config.fontSize - 2) : 12

        // Wrap long category names so each line stays bounded — this keeps every label
        // narrow enough to fit its slot and short enough vertically that it never needs an
        // extreme rotation (and never gets clipped by the canvas edge).
        const wrapChars = 14
        const wrapLines = Math.max(1, Math.ceil(maxLabelLen / wrapChars))
        const lineLen = Math.min(maxLabelLen, wrapChars)

        // Rotation is driven by how MANY categories compete for horizontal space, not by
        // name length (longer names are handled by wrapping + taller container instead).
        const labelRotate = (isAxis && !isHorizontal && maxLabelLen > 4)
          ? (count > 10 ? 55 : count > 6 ? 40 : 28)
          : 0

        const charPx = labelFontSize * 0.6
        const lineHeight = labelFontSize + 4
        const topMargin = config.title ? 50 : 24

        // Bottom room = bounding box of the rotated, possibly multi-line label.
        const rad = labelRotate * Math.PI / 180
        const labelBoxW = lineLen * charPx
        const labelBoxH = wrapLines * lineHeight
        const rotatedH = labelRotate
          ? Math.sin(rad) * labelBoxW + Math.cos(rad) * labelBoxH
          : labelBoxH
        const gridBottom = (isAxis && !isHorizontal)
          ? Math.min(Math.round(rotatedH) + 20, 300)
          : 24

        const userH = parseInt(String(config.chartHeight || '').replace(/[^\d]/g, ''), 10) || 0
        let chartHeight
        if (isAxis && !isHorizontal) {
          chartHeight = Math.min(topMargin + 200 + gridBottom, 720)
        } else if (isHorizontal) {
          chartHeight = Math.min(Math.max(240, count * 28 + topMargin + 24), 720)
        } else {
          // pie / donut / funnel / treemap / sunburst / polar: room for outside labels
          chartHeight = isItem ? 360 : 320
        }
        chartHeight = Math.max(chartHeight, userH)

        return { isItem, isHierarchy, isPolar, isAxis, isHorizontal, maxLabelLen, count, fontFamily, labelFontSize, labelRotate, gridBottom, topMargin, chartHeight, wrapChars }
      }

      const buildEChartsOption = (config, data) => {
        if (!config || !data) return null
        const layout = computeLayout(config, data)
        const { isItem, isHierarchy, isPolar, isAxis, isHorizontal, fontFamily, labelFontSize, labelRotate, gridBottom, topMargin, wrapChars } = layout

        // Break a long label into lines no wider than wrapChars (split on spaces, hard-break
        // very long single words) so the full name is always readable.
        const wrapLabel = (s) => {
          s = String(s ?? '')
          if (s.length <= wrapChars) return s
          const out = []
          let line = ''
          for (let word of s.split(' ')) {
            while (word.length > wrapChars) {
              if (line) { out.push(line); line = '' }
              out.push(word.slice(0, wrapChars))
              word = word.slice(wrapChars)
            }
            if (!line) line = word
            else if ((line + ' ' + word).length <= wrapChars) line += ' ' + word
            else { out.push(line); line = word }
          }
          if (line) out.push(line)
          return out.join('\n')
        }

        const getEChartsType = () => {
          if (config.type === 'area') return 'line'
          if (config.type === 'polarBar') return 'bar'
          if (config.type === 'horizontal_bar') return 'bar'
          if (config.type === 'donut') return 'pie' // a donut is a pie with an inner radius
          return config.type
        }

        const buildAxisSeriesData = () => {
          return (data.y_data || []).map((val, idx) => {
            const categoryName = (data.x_data || [])[idx]
            return {
              value: val,
              itemStyle: config.colorMode === 'manual' && config.customCategoryColors?.[categoryName]
                ? { color: config.customCategoryColors[categoryName] }
                : config.colorMode === 'multi'
                  ? { color: ['#054239', '#428177', '#8e7b5b', '#988561', '#1f5f54', '#b5a484'][idx % 6] }
                  : { color: config.themeColor || '#054239' }
            }
          })
        }

        const buildItemSeriesData = () => {
          return (data.x_data || []).map((name, i) => ({
            name,
            value: (data.y_data || [])[i],
            itemStyle: config.colorMode === 'manual' && config.customCategoryColors?.[name]
              ? { color: config.customCategoryColors[name] }
              : undefined
          }))
        }

        const seriesData = (isItem || isHierarchy) ? buildItemSeriesData() : buildAxisSeriesData()

        // Force every vertical category label (column name) to render, rotated to the
        // angle picked in computeLayout so long names never overlap or clip.
        const categoryAxisLabel = {
          interval: 0,            // show all labels, no auto-skipping
          rotate: labelRotate,    // rotate dynamically to avoid overlap
          hideOverlap: false,
          margin: 14,             // push names down so long, rotated labels clear the bars
          verticalAlign: 'top',
          fontFamily,
          fontSize: labelFontSize,
          lineHeight: labelFontSize + 4,
          color: '#002623',
          formatter: wrapLabel,   // wrap long names so the full text is visible
        }

        return {
          title: {
            text: config.title || '',
            left: 'center',
            textStyle: { fontSize: config.fontSize || 14, color: '#002623', fontFamily: config.fontFamily || 'Cairo, sans-serif' }
          },
          textStyle: { fontFamily: config.fontFamily || 'Cairo, sans-serif' },
          tooltip: { trigger: (isItem || isHierarchy) ? 'item' : 'axis' },
          grid: isAxis ? {
            left: '3%',
            right: '5%',
            bottom: gridBottom,
            top: topMargin,
            containLabel: true,
          } : undefined,
          xAxis: isAxis ? (isHorizontal
            ? { type: 'value' }
            : { type: 'category', data: data.x_data, axisLabel: categoryAxisLabel })
            : undefined,
          yAxis: isAxis ? (isHorizontal
            // Give category names a wide slot and don't wrap, so a long/tall column name
            // always stays on a single line (containLabel reserves the room it needs).
            ? { type: 'category', data: data.x_data, axisLabel: { interval: 0, hideOverlap: false, overflow: 'none', fontFamily, color: '#002623' } }
            : { type: 'value' })
            : undefined,
          polar: isPolar ? {} : undefined,
          angleAxis: isPolar ? { type: 'category', data: data.x_data, axisLabel: { interval: 0, hideOverlap: false, fontFamily } } : undefined,
          radiusAxis: isPolar ? {} : undefined,
          series: [{
            name: data.series_name,
            type: getEChartsType(),
            data: seriesData,
            ...(config.type === 'area' && { areaStyle: { color: '#8e7b5b' }, smooth: true }),
            ...(config.type === 'line' && { smooth: true }),
            ...(config.type === 'scatter' && { symbolSize: 12 }),
            ...(config.type === 'funnel' && { sort: 'descending', gap: 2 }),
            ...(config.type === 'treemap' && { roam: false }),
            ...(isPolar && { coordinateSystem: 'polar' }),
            ...(isAxis && { barWidth: config.barWidth ? `${config.barWidth}%` : '50%' }),
            // Show the value on/next to each bar.
            ...(['bar', 'horizontal_bar'].includes(config.type) && {
              label: {
                show: true,
                position: config.type === 'horizontal_bar' ? 'right' : 'top',
                fontFamily,
                fontSize: labelFontSize,
                color: '#002623',
              }
            }),
            // Line/area: show the value above each point.
            ...(['line', 'area'].includes(config.type) && {
              label: {
                show: true,
                position: 'top',
                fontFamily,
                fontSize: labelFontSize,
                color: '#002623',
              }
            }),
            ...(config.type === 'donut' && { radius: ['38%', '62%'] }),
            ...(config.type === 'pie' && { radius: '62%' }),
            ...(config.type === 'funnel' && { radius: '70%' }),
            // Keep category/data labels permanently visible on item charts (no hover needed).
            ...(isItem && {
              label: {
                show: true,
                position: config.type === 'funnel' ? 'inside' : 'outside',
                formatter: config.type === 'funnel' ? '{b}' : '{b}: {d}%',
                fontFamily,
                fontSize: labelFontSize,
                color: '#002623',
                // Wrap long slice names so they never run off the canvas edge.
                ...(config.type !== 'funnel' && { width: 110, overflow: 'break', lineHeight: labelFontSize + 4 }),
              },
              ...(config.type !== 'funnel' && { labelLine: { show: true, length: 12, length2: 10 } }),
              avoidLabelOverlap: true,
            }),
            // Treemap/sunburst: show the name AND the value (row count) inside each piece.
            ...(isHierarchy && {
              label: {
                show: true,
                fontFamily,
                fontSize: labelFontSize,
                color: '#fff',
                overflow: 'break',
                formatter: '{b}\n{c}',
              },
            }),
            ...(isAxis && {
              itemStyle: {
                borderRadius: ['bar', 'horizontal_bar'].includes(config.type) ? [4, 4, 0, 0] : undefined
              }
            })
          }]
        }
      }

      const renderChart = (config, data) => {
        // Honor a user-set height; otherwise size from the labels so rotated/long names
        // are never clipped.
        const chartHeight = node.attrs.height || computeLayout(config, data).chartHeight
        chartArea.innerHTML = ''
        const wrapper = document.createElement('div')
        wrapper.style.cssText = `width:100%;height:${chartHeight}px`
        chartArea.appendChild(wrapper)

        if (chartRoot) {
          try { chartRoot.unmount() } catch (e) {}
        }
        const option = buildEChartsOption(config, data) || {}
        chartRoot = ReactDOM.createRoot(wrapper)
        chartRoot.render(React.createElement(ReactECharts, {
          option,
          style: { height: `${chartHeight}px`, width: '100%' }
        }))
        // Record the exact rendered option for the Word export (editable SVG).
        chartExportRegistry.set(exportKey, {
          option,
          height: chartHeight,
          pos: typeof getPos === 'function' ? getPos() : exportKey,
        })
      }

      const fetchChartData = async (force = false) => {
        // Use the freshest config (synced from the tree) so we fetch with the chart's
        // drill-down filters, not just the columns.
        const config = syncedConfig || node.attrs.chartConfig
        if (!config || fetching) return

        const filters = config.filters || {}

        // Reuse cached data unless the caller explicitly forces a refresh. Keyed by the
        // inputs that actually change the data (file + columns + filters); style/shape changes
        // keep the same data and only re-render. Always render with the freshest config.
        const cacheKey = `${node.attrs.fileId}|${config.x}|${config.y || ''}|${JSON.stringify(filters)}`
        if (!force && chartDataCache.has(cacheKey)) {
          localChartData = chartDataCache.get(cacheKey)
          renderChart(config, localChartData)
          return
        }

        fetching = true
        chartArea.innerHTML = '<div class="text-sm text-gray-400 text-center py-8">جاري تحميل بيانات المخطط...</div>'
        try {
          const { apiPost } = await import('../api')
          const res = await apiPost('/api/chart-data', {
            file_id: node.attrs.fileId,
            x_column: config.x,
            y_column: config.y || '',
            filters,
          })
          if (res && res.x_data) {
            localChartData = { x_data: res.x_data, y_data: res.y_data, series_name: res.series_name }
            chartDataCache.set(cacheKey, localChartData)
            renderChart(config, localChartData)
          } else {
            console.error('[ChartNode] API returned non-success status', res)
            chartArea.innerHTML = '<div class="text-sm text-red-400 text-center py-8">فشل تحميل بيانات المخطط: ' + (res.message || 'خطأ غير معروف') + '</div>'
          }
        } catch (err) {
          console.error('[ChartNode] API call failed', { message: err.message, error: err })
          chartArea.innerHTML = '<div class="text-sm text-red-400 text-center py-8">فشل تحميل بيانات المخطط: ' + err.message + '</div>'
        } finally {
          fetching = false
        }
      }

      const updateChartStyle = (styleChanges) => {
        const config = { ...(node.attrs.chartConfig || {}) }
        Object.assign(config, styleChanges)
        const chain = editor.chain().focus()
        if (typeof getPos === 'function') chain.setNodeSelection(getPos())
        chain.updateAttributes('chartNode', { chartConfig: config }).run()
        if (localChartData) renderChart(config, localChartData)
      }

      const fetchLatestConfig = async (silent = false) => {
        const treeId = node.attrs.chartTreeId
        if (!treeId) return
        try {
          const res = await fetchTreeConfig(treeId)
          if (res.status === 'success' && res.data?.structure?.charts) {
            const structure = res.data.structure
            const charts = structure.charts
            const chartId = node.attrs.chartId
            const match = charts.find(c => c.id === chartId) || charts[0]
            if (match) {
              const current = node.attrs.chartConfig || {}
              // Re-derive the chart's drill-down filter context so the report shows the same
              // filtered slice (e.g. age WHERE gender=male), not the whole column. Prefer the
              // filter stored on the chart itself; older charts fall back to the breadcrumb
              // path that happens to be saved in the tree structure.
              const columnFilters = structure.column_filters || {}
              let filters
              if (match.filter && Object.keys(match.filter).length) {
                filters = { ...columnFilters, ...match.filter }
              } else {
                const breadcrumbs = structure.breadcrumbs || []
                let levelFilter = breadcrumbs.find(b => b.id === match.levelId)?.filter || {}
                // Legacy chart with a drill level but no stored/breadcrumb filter: reconstruct it
                // from the levelId hash so the report applies the correct drill-down condition.
                if ((!levelFilter || !Object.keys(levelFilter).length) && match.levelId && match.levelId !== 'root') {
                  try {
                    const recon = await reconstructTreeFilters(treeId, structure, node.attrs.fileId)
                    const f = recon.get(match.levelId)
                    if (f) levelFilter = f
                  } catch (e) { console.warn('[ChartNode] filter reconstruction failed', e) }
                }
                filters = { ...columnFilters, ...levelFilter }
              }
              // The global tree is the source of truth for the chart's shape and styling,
              // so its values win here — this is what makes edits made in the tree (type,
              // color, font, ...) actually appear in the report. Only report-specific
              // layout (width/height) stays local, falling back to the tree.
              const merged = {
                ...current,
                ...match,
                x: match.x,
                y: match.y || '',
                type: match.type || current.type,
                title: match.title || current.title,
                themeColor: match.themeColor || current.themeColor || '#054239',
                fontSize: match.fontSize || current.fontSize || 14,
                fontFamily: match.fontFamily || current.fontFamily || 'Cairo, sans-serif',
                chartWidth: current.chartWidth || match.chartWidth || 'md:col-span-1',
                chartHeight: current.chartHeight || match.chartHeight || '350px',
                barWidth: match.barWidth || current.barWidth || 50,
                colorMode: match.colorMode || current.colorMode || 'single',
                customCategoryColors: match.customCategoryColors || current.customCategoryColors || null,
                levelId: match.levelId ?? current.levelId ?? null,
                filters,
              }
              if (silent) {
                syncedConfig = merged
                if (localChartData) renderChart(merged, localChartData)
              } else {
                const chain = editor.chain().focus()
                if (typeof getPos === 'function') chain.setNodeSelection(getPos())
                chain.updateAttributes('chartNode', { chartConfig: merged }).run()
                if (localChartData) renderChart(merged, localChartData)
              }
            }
          }
        } catch (err) {
          console.warn('[ChartNode] Failed to sync from tree', err)
        }
      }

      // Component-background controls: seed from the saved config, live-update the opacity
      // label, and let "بدون" clear the color back to the default white card.
      const compBgColorInput = ctxPanel.querySelector('.comp-bg-color')
      const compBgOpacityInput = ctxPanel.querySelector('.comp-bg-opacity')
      const compBgOpacityVal = ctxPanel.querySelector('.comp-bg-opacity-val')
      let compBgEnabled = !!(node.attrs.chartConfig || {}).bgColor
      compBgColorInput.value = (node.attrs.chartConfig || {}).bgColor || '#ffffff'
      compBgOpacityInput.value = String(Math.round(((node.attrs.chartConfig || {}).bgOpacity ?? 1) * 100))
      compBgOpacityVal.textContent = compBgOpacityInput.value + '%'
      // Live preview: touching either control enables the background and shows it immediately,
      // so the user sees the effect before pressing تطبيق (which persists it).
      const previewCompBg = () => {
        compBgEnabled = true
        applyContainerBg({ bgColor: compBgColorInput.value, bgOpacity: (parseInt(compBgOpacityInput.value, 10) || 0) / 100 })
      }
      compBgColorInput.addEventListener('input', previewCompBg)
      compBgOpacityInput.addEventListener('input', () => {
        compBgOpacityVal.textContent = compBgOpacityInput.value + '%'
        previewCompBg()
      })
      ctxPanel.querySelector('.comp-bg-clear').addEventListener('click', () => {
        compBgEnabled = false
        compBgColorInput.value = '#ffffff'
        applyContainerBg({ ...(node.attrs.chartConfig || {}), bgColor: null })
      })

      ctxPanel.querySelector('.apply-btn').addEventListener('click', () => {
        const fillInput = ctxPanel.querySelector('.fill-color')
        const strokeInput = ctxPanel.querySelector('.stroke-color')
        const strokeWidth = ctxPanel.querySelector('.stroke-width')
        const fontSizeRange = ctxPanel.querySelector('.font-size-range')
        const titleColor = ctxPanel.querySelector('.title-color')
        const dataColor = ctxPanel.querySelector('.data-color')

        const bgColor = compBgEnabled ? compBgColorInput.value : null
        const bgOpacity = (parseInt(compBgOpacityInput.value, 10) || 0) / 100
        // Reflect the background immediately (updateAttributes recreates the view too).
        applyContainerBg({ bgColor, bgOpacity })

        updateChartStyle({
          themeColor: dataColor.value || undefined,
          fontSize: parseInt(fontSizeRange.value) || undefined,
          bgColor,
          bgOpacity,
        })

        editOpen = false
        ctxPanel.classList.add('hidden')
      })

      ctxPanel.querySelector('.refresh-btn').addEventListener('click', () => {
        fetchChartData(true)
      })

      ctxPanel.querySelector('.sync-btn').addEventListener('click', () => {
        fetchLatestConfig(false)
      })

      // Do the actual config + data load. Kept separate so it can be deferred until the
      // chart scrolls into view (see the IntersectionObserver below) — this keeps the
      // initial report open fast even when it contains many charts, since only the
      // visible ones fire their /api/chart-data request and spin up an ECharts instance.
      const loadChart = async () => {
        let config = syncedConfig || node.attrs.chartConfig
        if (!config) {
          console.warn('[ChartNode] No chartConfig found in attrs')
          chartArea.innerHTML = '<div class="text-sm text-gray-400 text-center py-8">لم يتم تحديد مخطط</div>'
          return
        }
        // Resolve the freshest config (incl. drill-down filters) from the tree BEFORE fetching
        // data, so the very first fetch is already scoped to the chart's filter context.
        if (node.attrs.chartTreeId && !syncedConfig) {
          await fetchLatestConfig(true)
          config = syncedConfig || config
        }
        if (localChartData) {
          renderChart(config, localChartData)
        } else {
          fetchChartData()
        }
      }

      // Reserve vertical space and show a lightweight placeholder until the chart loads,
      // so the page doesn't jump as off-screen charts come in.
      chartArea.innerHTML = '<div class="text-sm text-gray-400 text-center py-8" style="min-height:300px;display:flex;align-items:center;justify-content:center">جاري تحميل المخطط...</div>'

      let loaded = false
      let observer = null
      const triggerLoad = () => {
        if (loaded) return
        loaded = true
        if (observer) { try { observer.disconnect() } catch (e) {} observer = null }
        loadChart()
      }

      // PDF export captures the DOM, so any still-lazy chart must render first. The editor
      // dispatches this event before exporting to force every chart to load immediately.
      const onForceLoad = () => triggerLoad()
      window.addEventListener('chart-force-load', onForceLoad)

      if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver((entries) => {
          if (entries.some(e => e.isIntersecting)) triggerLoad()
        }, { rootMargin: '600px 0px' }) // start loading a bit before it reaches the viewport
        observer.observe(container)
      } else {
        triggerLoad()
      }

      // Drag the handle to set the chart's width/height, then persist to the node attrs
      // (the node view rebuilds and re-renders the chart at the new size, like images).
      let resizing = false
      resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        resizing = true
        const startX = e.clientX
        const startY = e.clientY
        const startWidth = container.offsetWidth
        const innerWrapper = chartArea.firstElementChild
        const startHeight = innerWrapper ? innerWrapper.offsetHeight : chartArea.offsetHeight || 300
        document.body.style.userSelect = 'none'

        const onMove = (ev) => {
          if (!resizing) return
          const newWidth = Math.max(220, startWidth + (ev.clientX - startX))
          const newHeight = Math.max(180, startHeight + (ev.clientY - startY))
          container.style.width = newWidth + 'px'
          container.style.maxWidth = '100%'
          container.style.marginLeft = 'auto'
          container.style.marginRight = 'auto'
          const w = chartArea.firstElementChild
          if (w) w.style.height = newHeight + 'px'
        }

        const onUp = () => {
          resizing = false
          document.body.style.userSelect = ''
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
          const w = chartArea.firstElementChild
          const finalWidth = Math.round(container.offsetWidth)
          const finalHeight = Math.round(w ? w.offsetHeight : chartArea.offsetHeight)
          const pos = typeof getPos === 'function' ? getPos() : undefined
          if (pos !== undefined) {
            editor.chain().focus().setNodeSelection(pos).updateAttributes('chartNode', {
              width: finalWidth,
              height: finalHeight,
            }).run()
          }
        }

        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      })

      return {
        dom: container,
        ignoreMutation: () => true,
        destroy: () => {
          window.removeEventListener('chart-force-load', onForceLoad)
          chartExportRegistry.delete(exportKey)
          if (observer) { try { observer.disconnect() } catch (e) {} }
          if (chartRoot) {
            try { chartRoot.unmount() } catch (e) {}
          }
        }
      }
    }
  },
})

export default ChartNode