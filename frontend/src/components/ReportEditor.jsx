import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, FontSize } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import { apiPut, apiUpload, apiPost } from '../api'
import ResizableImage from '../extensions/ResizableImage'
import ChartNode, { chartExportRegistry } from '../extensions/ChartNode'
import PageBreakNode from '../extensions/PageBreakNode'
import Pagination, { paginationKey } from '../extensions/Pagination'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import FontFamily from '@tiptap/extension-font-family'
import FontManager from './FontManager'
import ChartPickerModal from './ChartPickerModal'
import { BG_TEMPLATES, TEMPLATE_PREFIX, resolveBgSrc, loadImage } from '../lib/reportBackgrounds'
import {
  Bold, Italic, Underline as UnderlineIcon,
  List, ListOrdered, Table as TableIcon, Image, ChartBarBig, ArrowLeft, Save, FileDown,
  Undo2, Redo2, AlignLeft, AlignCenter, AlignRight, Minus, Highlighter, Palette, Type, Plus, Trash2, X,
  Images, Upload as UploadIcon, Check, Eye, SeparatorHorizontal
} from 'lucide-react'

// Footer page-number settings, merged over whatever the report config stores. size is in points.
const PAGE_NUMBER_DEFAULTS = { enabled: false, align: 'center', color: '#054239', font: '', size: 11, format: 'plain', numerals: 'latin' }

// Convert Latin digits to Arabic-Indic when requested (reports are Arabic).
const toNumerals = (s, style) => style === 'arabic' ? String(s).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]) : String(s)

// The footer text for page n of `total`, per the chosen format + numeral style.
const formatPageNumber = (n, total, cfg) => {
  const N = toNumerals(n, cfg.numerals)
  const T = toNumerals(total, cfg.numerals)
  if (cfg.format === 'withTotal') return `${N} / ${T}`
  if (cfg.format === 'arabic') return `صفحة ${N} من ${T}`
  return N
}

// Paint the page number into the footer margin of a page canvas (shared by the PDF export and the
// on-screen preview). geom is in mm; pxPerMm maps mm onto that canvas's pixel grid.
const drawPageNumberOnCanvas = (ctx, n, total, cfg, geom) => {
  const { pxPerMm, pageWidth, pageHeight, marginX, marginY } = geom
  const text = formatPageNumber(n, total, cfg)
  const fontPx = (cfg.size || 11) * (25.4 / 72) * pxPerMm // pt -> mm -> px
  ctx.save()
  ctx.font = `${fontPx}px ${cfg.font ? `"${cfg.font}", ` : ''}sans-serif`
  ctx.fillStyle = cfg.color || '#000000'
  ctx.textBaseline = 'middle'
  ctx.textAlign = cfg.align === 'left' ? 'left' : cfg.align === 'right' ? 'right' : 'center'
  if (/[؀-ۿ]/.test(text)) ctx.direction = 'rtl'
  // Centre the number vertically in the bottom margin band (kept a little off the paper edge).
  const y = (pageHeight - Math.min(marginY, Math.max(marginY / 2, 4))) * pxPerMm
  const x = (cfg.align === 'left' ? marginX : cfg.align === 'right' ? pageWidth - marginX : pageWidth / 2) * pxPerMm
  ctx.fillText(text, x, y)
  ctx.restore()
}

export default function ReportEditor({ report, project, onBack, fonts = [], isAdmin, onFontAdded }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [title, setTitle] = useState(report.title || '')
  const [chartTrees, setChartTrees] = useState([])
  const [hasUnsaved, setHasUnsaved] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewPages, setPreviewPages] = useState([])
  // Live page-boundary guides: y-positions (in editor px) where each A4 page will be cut on
  // export, computed block-aware with the exact same logic as the PDF export/preview so the
  // marks land where the real cuts do — lets the user see pagination without opening معاينة.
  const [pageGuides, setPageGuides] = useState([])
  // Per-page background tiles (one per A4 page region) so the background repeats on every page
  // instead of one image stretched over the whole scroll. { top, src, color, opacity }; each tile
  // is drawn a full page tall (pageHeightScreen) so it also fills the margins, like the export.
  const [pageBgRegions, setPageBgRegions] = useState([])
  // On-screen height (px) of one full A4 page, used to size the per-page background tiles so each
  // shows a full page (content area + the margins) exactly like the exported page.
  const [pageHeightScreen, setPageHeightScreen] = useState(0)
  const [showFontManager, setShowFontManager] = useState(false)
  const [showTablePopover, setShowTablePopover] = useState(false)
  const [tableRows, setTableRows] = useState(3)
  const [tableCols, setTableCols] = useState(3)
  const [tableHeader, setTableHeader] = useState(true)
  const [tableToolbarPos, setTableToolbarPos] = useState(null)
  const [showChartPicker, setShowChartPicker] = useState(false)
  const [config, setConfig] = useState(report.config || {})
  const [showBgPanel, setShowBgPanel] = useState(false)
  const [uploadingBg, setUploadingBg] = useState(false)
  const backgroundUrl = config.backgroundImageUrl || null
  // The actual image source for preview/export (resolves `tmpl:<id>` to its asset URL).
  const resolvedBg = resolveBgSrc(backgroundUrl)
  // Page padding (in mm) applied around the content on every exported page. Lets the user
  // push content off the paper edge / a full-bleed background (set to 0 = no white border)
  // or in from a framed template like «إطار» so text doesn't sit on the frame.
  const pagePaddingX = config.pagePaddingX ?? 12
  const pagePaddingY = config.pagePaddingY ?? 12
  // Footer page-number settings (defaults filled in), used by the editor overlay + export/preview.
  const pageNum = { ...PAGE_NUMBER_DEFAULTS, ...(config.pageNumber || {}) }
  // Always-current config so the (debounced) autosave never persists a stale background.
  const configRef = useRef(report.config || {})
  // A template has no project; charts reference project-specific trees, so they are not
  // insertable while editing a template (they only make sense inside a project's report).
  const isTemplate = !(project?.id || report.project_id)
  const saveTimerRef = useRef(null)
  const fileInputRef = useRef(null)
  const bgInputRef = useRef(null)
  const colorInputRef = useRef(null)
  const highlightInputRef = useRef(null)
  const printTitleRef = useRef(null)
  // Signature of the currently-applied pagination spacers, so we only dispatch a transaction when
  // the page layout actually changes (avoids a dispatch loop with the layout observer).
  const paginationSigRef = useRef('')
  // Safety cap on consecutive re-paginations without an edit: inserting spacers can nudge the
  // layout (broken margin-collapsing) and, for content sitting exactly on a boundary, flip the
  // cut back and forth. This bounds that to a few settling passes; it resets on every doc edit.
  const paginationIterRef = useRef(0)
  // While a capture (export/preview) is running the spacers are stripped; suspend re-pagination so
  // the layout observer doesn't race in and re-insert them mid-capture.
  const paginationSuspendedRef = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: true }),
      Table.configure({ resizable: true }),
      TableRow, TableCell, TableHeader,
      Placeholder.configure({ placeholder: 'ابدأ بكتابة التقرير...' }),
      ResizableImage,
      ChartNode,
      PageBreakNode,
      Pagination,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      HorizontalRule,
      FontFamily,
    ],
    content: report.content || { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[500px] px-8 py-6 font-sans leading-relaxed',
        dir: 'rtl',
      },
    },
    onUpdate: () => {
      setSaved(false)
      setHasUnsaved(true)
      debouncedSave()
    },
  })

  useEffect(() => {
    fetchChartTrees()
  }, [])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      if (hasUnsaved && editor && report.id) {
        saveReport(editor.getJSON())
      }
    }
  }, [hasUnsaved, editor, report.id])

  useEffect(() => {
    if (!editor) return
    const updateTableToolbar = () => {
      if (editor.isActive('table')) {
        const { view } = editor
        const { selection } = view.state
        const coords = view.coordsAtPos(selection.$anchor.pos)
        if (coords) {
          setTableToolbarPos({ top: coords.top - 10, left: coords.left + (coords.right - coords.left) / 2 })
        }
      } else {
        setTableToolbarPos(null)
      }
    }
    editor.on('selectionUpdate', updateTableToolbar)
    return () => { editor.off('selectionUpdate', updateTableToolbar) }
  }, [editor])

  const fetchChartTrees = async () => {
    // Templates have no project, hence no chart trees to insert.
    if (isTemplate) return
    try {
      const { apiGet } = await import('../api')
      const res = await apiGet('/api/global-chart-trees', { project_id: project?.id || report.project_id })
      if (res.status === 'success') setChartTrees(res.data || [])
    } catch (err) {
      console.error('Failed to load chart trees:', err)
    }
  }

  const debouncedSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      if (editor && report.id) {
        setSaving(true)
        saveReport(editor.getJSON())
      }
    }, 5000)
  }, [editor, report.id])

  const saveReport = async (content) => {
    try {
      await apiPut(`/api/reports/${report.id}`, {
        title,
        content,
        config: configRef.current,
      })
      setSaving(false)
      setSaved(true)
      setHasUnsaved(false)
    } catch (err) {
      setSaving(false)
      console.error('Failed to save report:', err)
    }
  }

  // Update the PDF background (a bundled template URL, an uploaded image URL, or null
  // to clear it) and persist it in the report config immediately.
  const applyBackground = (url) => {
    const next = { ...configRef.current, backgroundImageUrl: url || null }
    configRef.current = next
    setConfig(next)
    if (editor && report.id) {
      setSaving(true)
      saveReport(editor.getJSON())
    }
  }

  // Update an export page-padding value (mm). Clamped, stored in config, and persisted via
  // the debounced autosave so dragging the number input doesn't fire a save per keystroke.
  const applyPadding = (axis, value) => {
    const v = Math.max(0, Math.min(60, Math.round(Number(value) || 0)))
    const next = { ...configRef.current, [axis]: v }
    configRef.current = next
    setConfig(next)
    setHasUnsaved(true)
    debouncedSave()
  }

  // Merge a patch into the footer page-number config and persist via the debounced autosave.
  const applyPageNumber = (patch) => {
    const next = { ...configRef.current, pageNumber: { ...PAGE_NUMBER_DEFAULTS, ...(configRef.current.pageNumber || {}), ...patch } }
    configRef.current = next
    setConfig(next)
    setHasUnsaved(true)
    debouncedSave()
  }

  const handleBgUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingBg(true)
    try {
      const res = await apiUpload('/api/reports/upload-image', file)
      if (res.status === 'success') {
        applyBackground(res.data.url)
      }
    } catch (err) {
      console.error('Failed to upload background:', err)
      alert('فشل رفع صورة الخلفية')
    } finally {
      setUploadingBg(false)
    }
  }

  const handleManualSave = () => {
    if (editor) {
      setSaving(true)
      saveReport(editor.getJSON())
    }
  }

  // Resolve once every chart node has rendered its canvas (or after a safety timeout),
  // then give ECharts a moment to finish its entry animation so the capture isn't mid-frame.
  const waitForCharts = (root) => new Promise((resolve) => {
    const start = Date.now()
    const check = () => {
      const wrappers = Array.from(root.querySelectorAll('.chart-node-wrapper'))
      const allReady = wrappers.every(w => w.querySelector('canvas'))
      if (allReady || Date.now() - start > 8000) {
        setTimeout(resolve, 900)
      } else {
        setTimeout(check, 150)
      }
    }
    check()
  })

  // Rasterize a (same-origin) SVG template to an A4-ratio PNG data URL so jsPDF can draw it.
  // The SVG is fetched and loaded via a blob URL so the export canvas stays origin-clean
  // (drawing an <img src=*.svg> straight into a canvas taints it in several browsers, which
  // would make toDataURL throw and silently drop the background).
  const rasterizeSvg = async (url) => {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error('SVG fetch failed: ' + resp.status)
    const svgText = await resp.text()
    const blobUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }))
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new window.Image()
        im.crossOrigin = 'anonymous'
        im.onload = () => resolve(im)
        im.onerror = reject
        im.src = blobUrl
      })
      const c = document.createElement('canvas')
      c.width = 1240
      c.height = 1754
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      return c.toDataURL('image/png')
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  }

  // Resolve a background image src (defaults to the global report background) to a clean
  // { dataUrl, format } for jsPDF/canvas, or null. Bundled SVG templates rasterize locally;
  // uploaded images are fetched as base64 through the API so the export canvas stays untainted.
  const resolveBackgroundDataUrl = async (src = resolvedBg) => {
    if (!src) return null
    try {
      // Bundled templates resolve to an SVG: either a hashed `*.svg` URL (dev / large files)
      // or, when small enough, a `data:image/svg+xml,...` URI that Vite inlines at build time.
      // Both must be rasterized locally; the inlined form lacks the `.svg` substring, so check
      // the data-URI mime type too (missing this made every template silently fail to export).
      const isSvg = /^data:image\/svg/i.test(src) || src.toLowerCase().includes('.svg')
      if (isSvg) {
        return { dataUrl: await rasterizeSvg(src), format: 'PNG' }
      }
      const res = await apiPost('/api/reports/image-data', { url: src })
      if (res.status === 'success' && res.data?.dataUrl) {
        const isJpeg = /^data:image\/jpe?g/i.test(res.data.dataUrl)
        return { dataUrl: res.data.dataUrl, format: isJpeg ? 'JPEG' : 'PNG' }
      }
    } catch (err) {
      console.error('Failed to load background image:', err)
    }
    return null
  }

  // Read the manual page breaks from the captured editor layout and turn each into a section:
  // its top/bottom edge (in canvas px, so it can force a hard page cut and be skipped) plus its
  // background (image resolved to a clean data URL, solid color, and opacity). Sections are
  // returned sorted top-to-bottom; a page belongs to the last section whose break sits above it.
  const collectPageSections = async (area, areaRect, domToCanvas) => {
    const els = Array.from(area.querySelectorAll('.ProseMirror > [data-page-break]'))
    const sections = []
    for (const el of els) {
      const r = el.getBoundingClientRect()
      const topPx = (r.top - areaRect.top) * domToCanvas
      const bottomPx = (r.bottom - areaRect.top) * domToCanvas
      const bgImage = el.getAttribute('data-bg-image') || null
      const bgColor = el.getAttribute('data-bg-color') || null
      const bgOpacity = parseFloat(el.getAttribute('data-bg-opacity') || '1')
      const imgResolved = bgImage ? await resolveBackgroundDataUrl(resolveBgSrc(bgImage)) : null
      sections.push({ topPx, bottomPx, bgColor, bgOpacity, imgDataUrl: imgResolved?.dataUrl || null })
    }
    return sections.sort((a, b) => a.topPx - b.topPx)
  }

  // Slice the captured canvas into pages (block-aware, so no block is split), honoring manual
  // page breaks and per-section backgrounds. Shared verbatim by the PDF export and the preview.
  // Each returned slice is { sTop, sBottom, section }, where `section` is the background to paint
  // on that page or null (=> global background). A break's background applies to exactly ONE
  // page — the first page after the break — then reverts to global (single-page scope). Blank
  // slices (e.g. the empty region before a break placed at the top) are dropped.
  const buildSlices = (canvasHeight, usablePageHeightPx, sortedBreaks, sections, hasContentBetween) => {
    const slices = []
    let start = 0
    let pendingSection = null // background for the next emitted page (the one right after a break)
    while (start < canvasHeight - 1) {
      const maxEnd = start + usablePageHeightPx
      // A manual page break within reach ends the page at its top, even if more content would fit.
      let hardBand = null
      for (const s of sections) {
        if (s.topPx > start + 1 && s.topPx <= maxEnd && (!hardBand || s.topPx < hardBand.topPx)) hardBand = s
      }
      let end
      if (hardBand) {
        end = hardBand.topPx
      } else {
        end = 0
        for (const b of sortedBreaks) {
          if (b > start && b <= maxEnd && b > end) end = b
        }
        if (end <= start) {
          // A single block is taller than a full page: give it its own page (scaled to fit).
          let next = canvasHeight
          for (const b of sortedBreaks) { if (b > start && b < next) next = b }
          end = next
        }
      }
      const hitBreak = hardBand && Math.abs(end - hardBand.topPx) < 1
      const nextStart = hitBreak ? hardBand.bottomPx : end
      // Only emit a page if this slice holds content (drops the blank page a break would create
      // when nothing precedes it). The pending section applies to just this one page.
      if (hasContentBetween(start, end)) {
        slices.push({ sTop: start, sBottom: Math.min(end, canvasHeight), section: pendingSection })
        pendingSection = null
      }
      // After the break, the page that follows gets its background (if it defines one).
      if (hitBreak) pendingSection = (hardBand.bgColor || hardBand.imgDataUrl) ? hardBand : null
      start = nextStart
    }
    return slices
  }

  // Paginate the editor live: measure the blocks, work out the block-aware page cuts with the
  // exact same slicing the export uses, then (a) insert real spacer gaps so each page's content
  // ends at its bottom-margin line and the next page starts below its header, (b) place a
  // full-page background tile per page, and (c) draw an end line + start line at every boundary.
  const computePagination = useCallback(() => {
    if (!editor || editor.isDestroyed || paginationSuspendedRef.current) return
    const area = document.getElementById('report-print-area')
    const pm = area?.querySelector('.ProseMirror')
    if (!area || !pm) { setPageGuides([]); setPageBgRegions([]); return }

    const areaRect = area.getBoundingClientRect()
    const areaWidth = areaRect.width
    if (areaWidth < 1) { setPageGuides([]); setPageBgRegions([]); return }

    // The outer page (content + the margin padding) sets the page scale: its full width is a full
    // A4 page (210mm). So px-per-mm = outerWidth/210, a full page is outerWidth×297/210 tall, and
    // one vertical margin is pagePaddingY at that scale.
    const outer = document.getElementById('report-page')
    const outerWidth = outer ? outer.getBoundingClientRect().width : areaWidth
    const pageHeightPx = outerWidth * 297 / 210
    const marginYpx = pagePaddingY * outerWidth / 210
    setPageHeightScreen(pageHeightPx)

    const contentWidthMm = 210 - pagePaddingX * 2
    const contentHeightMm = 297 - pagePaddingY * 2
    if (contentWidthMm <= 0 || contentHeightMm <= 0) { setPageGuides([]); setPageBgRegions([]); return }
    // Usable content height per page, in editor px — mirrors the export's usablePageHeightPx.
    const usablePageHeightPx = contentHeightMm * (areaWidth / contentWidthMm)

    // Doc position at the start of each top-level node, so a spacer can be placed before it.
    const startPositions = []
    { let p = 0; editor.state.doc.forEach((node) => { startPositions.push(p); p += node.nodeSize }) }

    // Measure every top-level block in *natural* (gap-free) coordinates: subtract the spacers that
    // currently sit above it, so the geometry matches the export's gapless capture. Skip the
    // spacer widgets themselves (they carry class `pagination-gap`).
    let cumSpacer = 0
    const blocks = []
    Array.from(pm.children).forEach((el) => {
      if (el.classList.contains('pagination-gap')) { cumSpacer += el.offsetHeight; return }
      const r = el.getBoundingClientRect()
      blocks.push({
        top: (r.top - areaRect.top) - cumSpacer,
        bottom: (r.bottom - areaRect.top) - cumSpacer,
        isBreak: el.hasAttribute('data-page-break'),
        bgColor: el.getAttribute('data-bg-color') || null,
        bgOpacity: parseFloat(el.getAttribute('data-bg-opacity') || '1'),
        imgDataUrl: resolveBgSrc(el.getAttribute('data-bg-image')) || null,
      })
    })
    // The block DOM and the doc's top-level nodes must line up 1:1 for the positions to be valid;
    // if a transient render desyncs them, bail and let the next observer tick retry.
    if (blocks.length !== startPositions.length || blocks.length === 0) return

    const naturalHeight = blocks[blocks.length - 1].bottom
    const breaks = [0]
    const contentBlocks = []
    const sections = []
    blocks.forEach((b) => {
      if (b.top > 1 && b.top < naturalHeight - 1) breaks.push(b.top)
      if (b.isBreak) sections.push({ topPx: b.top, bottomPx: b.bottom, bgColor: b.bgColor, bgOpacity: b.bgOpacity, imgDataUrl: b.imgDataUrl })
      else contentBlocks.push({ top: b.top, bottom: b.bottom })
    })
    breaks.push(naturalHeight)
    const sortedBreaks = [...new Set(breaks)].sort((a, b) => a - b)
    const hasContentBetween = (a, b) => contentBlocks.some(bl => bl.bottom > a + 1 && bl.top < b - 1)

    const slices = buildSlices(naturalHeight, usablePageHeightPx, sortedBreaks, sections, hasContentBetween)

    // (a) Spacers: before each page's first block, add (fullPage − contentUsedOnPrevPage) so its
    // content lands exactly at the next page's content-zone top (= bottom margin + unused space +
    // top margin). Clamp to one gap (2 margins) so an over-tall block never yields a negative gap.
    const spacerSpecs = []
    for (let k = 0; k < slices.length - 1; k++) {
      const nextTop = slices[k + 1].sTop
      const idx = blocks.findIndex((b) => b.top >= nextTop - 2)
      if (idx < 0) continue
      const used = slices[k].sBottom - slices[k].sTop
      const gap = Math.max(2 * marginYpx, pageHeightPx - used)
      spacerSpecs.push({ pos: startPositions[idx], height: Math.round(gap) })
    }

    // Only dispatch when the spacer layout actually changed (prevents a loop with the observer).
    // Heights are quantized to 3px so sub-pixel layout jitter doesn't count as a change, and a
    // hard iteration cap breaks any residual oscillation until the next edit resets it.
    const sig = spacerSpecs.map((s) => `${s.pos}:${Math.round(s.height / 3)}`).join('|')
    if (sig !== paginationSigRef.current && paginationIterRef.current < 8) {
      paginationSigRef.current = sig
      paginationIterRef.current += 1
      const decos = spacerSpecs.map((s) => Decoration.widget(s.pos, () => {
        const d = document.createElement('div')
        d.className = 'pagination-gap'
        d.style.height = `${s.height}px`
        d.setAttribute('data-html2canvas-ignore', 'true')
        d.setAttribute('contenteditable', 'false')
        return d
      }, { side: -1, key: `gap:${s.pos}:${s.height}` }))
      editor.view.dispatch(editor.view.state.tr.setMeta(paginationKey, DecorationSet.create(editor.state.doc, decos)))
    }

    // (b) A full-page background tile per page, stacked one page apart, so the background repeats
    // and fills the margins/header/footer band around every page.
    setPageBgRegions(slices.map((s, i) => {
      const section = s.section
      return {
        top: i * pageHeightPx,
        src: section?.imgDataUrl || resolvedBg || null,
        color: section?.bgColor || null,
        opacity: section ? (section.bgOpacity ?? 1) : 1,
      }
    }))

    // (c) End line at each page's content bottom + start line at the next page's content top, with
    // the empty margin band (background header/footer) between them.
    const guides = []
    for (let i = 0; i < slices.length - 1; i++) {
      guides.push({ end: i * pageHeightPx + usablePageHeightPx, start: (i + 1) * pageHeightPx, page: i + 1 })
    }
    setPageGuides(guides)
  }, [editor, pagePaddingX, pagePaddingY, resolvedBg])

  // Keep pagination in sync: recompute on any size change of the report area (covers edits,
  // image/chart loads, and window/width changes) and whenever the page margins change.
  useEffect(() => {
    if (!editor) return
    const area = document.getElementById('report-print-area')
    if (!area) return
    // Margins/background just changed (this effect re-ran): allow a fresh round of settling passes.
    paginationIterRef.current = 0
    let raf = 0
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(computePagination)
    }
    // A real edit changes the content, so reset the settling cap before recomputing.
    const onEdit = () => { paginationIterRef.current = 0; schedule() }
    schedule()
    const ro = new ResizeObserver(schedule)
    ro.observe(area)
    const pm = area.querySelector('.ProseMirror')
    if (pm) ro.observe(pm)
    editor.on('update', onEdit)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      editor.off('update', onEdit)
    }
  }, [editor, computePagination])

  // Composite a section's color (at opacity) then its image (at opacity) onto a page-sized
  // canvas and return a PNG data URL. Opacity applies to both, so a template can be faded to a
  // watermark. Used by both the PDF export (addImage full page) and the on-screen preview.
  const buildSectionBgDataUrl = async (section, wPx, hPx) => {
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(wPx))
    c.height = Math.max(1, Math.round(hPx))
    const ctx = c.getContext('2d')
    const op = section.bgOpacity == null ? 1 : section.bgOpacity
    if (section.bgColor) {
      ctx.save(); ctx.globalAlpha = op; ctx.fillStyle = section.bgColor
      ctx.fillRect(0, 0, c.width, c.height); ctx.restore()
    }
    if (section.imgDataUrl) {
      const img = await loadImage(section.imgDataUrl)
      ctx.save(); ctx.globalAlpha = op
      ctx.drawImage(img, 0, 0, c.width, c.height); ctx.restore()
    }
    return c.toDataURL('image/png')
  }

  // html2canvas can't read cross-origin images (the body images are served from the Laravel
  // backend on another origin), so any inserted image comes out blank in the capture. Before
  // capturing we swap each such <img> to a base64 data URL fetched via /api/reports/image-data
  // (the same endpoint the background uses) and wait for it to load. Returns a restore function
  // that puts the original srcs back, so this only affects the capture — never the live editor.
  const inlineImagesForCapture = async (root) => {
    const imgs = Array.from(root.querySelectorAll('img'))
      .filter(img => img.src && !img.src.startsWith('data:') && !img.src.startsWith('blob:'))
    const restore = []
    await Promise.all(imgs.map(async (img) => {
      try {
        const res = await apiPost('/api/reports/image-data', { url: img.src })
        if (res.status === 'success' && res.data?.dataUrl) {
          const original = img.getAttribute('src')
          await new Promise((resolve) => {
            img.onload = resolve
            img.onerror = resolve
            img.src = res.data.dataUrl
          })
          restore.push(() => { img.setAttribute('src', original) })
        }
      } catch (err) {
        console.error('Failed to inline image for capture:', img.src, err)
      }
    }))
    return () => restore.forEach(fn => fn())
  }

  const handleExportPdf = async () => {
    const area = document.getElementById('report-print-area')
    if (!area || exporting) return

    // Persist latest content before exporting
    if (editor && hasUnsaved && report.id) {
      setSaving(true)
      saveReport(editor.getJSON())
    }

    setExporting(true)
    try {
      const [{ default: html2canvas }, { default: jsPDF }, echarts, { svg2pdf }] = await Promise.all([
        import('html2canvas-pro'),
        import('jspdf'),
        import('echarts'),
        import('svg2pdf.js'),
      ])

      // Live pagination inserts spacer gaps into the editor flow; the exporter paginates the
      // gapless content itself, so strip the spacers for the whole capture and restore them in
      // `finally`. The refs are reset so the restore actually re-dispatches.
      paginationSuspendedRef.current = true
      editor?.view?.dispatch(editor.view.state.tr.setMeta(paginationKey, DecorationSet.empty))
      paginationSigRef.current = ''
      paginationIterRef.current = 0

      // Force any lazy (off-screen) charts to load and finish drawing before we capture,
      // otherwise html2canvas would snapshot their loading placeholder instead of the chart.
      window.dispatchEvent(new Event('chart-force-load'))
      await waitForCharts(area)

      // Inline cross-origin body images to base64 so they render in the capture (restored below).
      const restoreImages = await inlineImagesForCapture(area)

      // Resolve the page background (if any) before capturing the content.
      const bg = await resolveBackgroundDataUrl()

      // Show the report title inside the captured area
      if (printTitleRef.current) printTitleRef.current.style.display = 'block'

      // The preview paints the background via CSS on the (multi-page-tall) report area, so
      // ALWAYS hide it during capture — otherwise html2canvas bakes it into the content and
      // it gets sliced across pages (header on page 1, footer on the last, content-height
      // coverage). We instead composite the background fresh, full-page, on every page below.
      // With a background, content is captured on transparency so it shows through.
      // The card frame (border / rounded corners / shadow) is for the on-screen preview only —
      // strip it during capture too, otherwise html2canvas bakes a white rounded border around
      // the content in the exported PDF.
      const prevAreaBg = area.style.backgroundColor
      const prevAreaBgImage = area.style.backgroundImage
      const prevAreaBorder = area.style.border
      const prevAreaRadius = area.style.borderRadius
      const prevAreaShadow = area.style.boxShadow
      area.style.backgroundColor = 'transparent'
      area.style.backgroundImage = 'none'
      area.style.border = 'none'
      area.style.borderRadius = '0'
      area.style.boxShadow = 'none'

      // Charts are ECharts canvases — letting html2canvas rasterize them bakes a blurry bitmap
      // into the PDF. Instead we hide each chart's graphic during capture (its card box still
      // reserves the space) and re-draw the exact same option afterwards: as crisp vector SVG,
      // or (for Arabic charts svg2pdf can't shape) as a high-res image. Only charts with a
      // registered option are handled; any other stays visible so it still rasterizes.
      const exportCharts = Array.from(area.querySelectorAll('.chart-node-area[data-chart-export-key]'))
        .filter(el => chartExportRegistry.get(Number(el.dataset.chartExportKey))?.option)
      const prevChartVis = exportCharts.map(el => el.style.visibility)
      exportCharts.forEach(el => { el.style.visibility = 'hidden' })

      // Page-break dividers are editor-only controls — hide them during capture (their box still
      // reserves space, so measured break positions stay valid) so the divider never prints.
      const pbEls = Array.from(area.querySelectorAll('.ProseMirror > [data-page-break]'))
      const prevPbVis = pbEls.map(el => el.style.visibility)
      pbEls.forEach(el => { el.style.visibility = 'hidden' })

      // Render the report area to a high-resolution canvas
      let canvas
      try {
        canvas = await html2canvas(area, {
          scale: 2,
          useCORS: true,
          backgroundColor: bg ? null : '#ffffff',
        })
      } finally {
        // NOTE: the report title stays shown (display:block) until the very end of the export —
        // it was baked into `canvas`, so all the block/chart position measurements below must be
        // taken with it still occupying space, or their coordinates won't match the capture
        // (which shifted the top charts up and pushed their titles out of the card). It's hidden
        // again in the outer finally.
        area.style.backgroundColor = prevAreaBg
        area.style.backgroundImage = prevAreaBgImage
        area.style.border = prevAreaBorder
        area.style.borderRadius = prevAreaRadius
        area.style.boxShadow = prevAreaShadow
        exportCharts.forEach((el, idx) => { el.style.visibility = prevChartVis[idx] })
        pbEls.forEach((el, idx) => { el.style.visibility = prevPbVis[idx] })
        restoreImages()
      }

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()

      // User-configurable padding (mm) reserved around the content on every page. 0 lets a
      // full-bleed background reach the paper edge (no white border); larger values keep text
      // clear of framed templates.
      const marginX = pagePaddingX
      const marginY = pagePaddingY
      const contentWidthMm = pageWidth - marginX * 2
      const contentHeightMm = pageHeight - marginY * 2

      // The image is scaled to fill the content width, so this is the canvas-px-per-mm ratio.
      const pxPerMm = canvas.width / contentWidthMm
      const usablePageHeightPx = contentHeightMm * pxPerMm

      // Collect break candidates: the top edge (in canvas px) of every top-level block in the
      // editor. We only ever cut a page at one of these boundaries, so a chart/paragraph/table
      // is never split across two pages. (Charts are atom nodes => a single block.)
      const areaRect = area.getBoundingClientRect()
      const domToCanvas = canvas.height / areaRect.height
      const breaks = [0]
      // Real content blocks (everything except manual page breaks), so we can drop any page
      // slice that would be blank — e.g. the empty region before a break placed at the top.
      const contentBlocks = []
      area.querySelectorAll('.ProseMirror > *').forEach((el) => {
        const r = el.getBoundingClientRect()
        const top = (r.top - areaRect.top) * domToCanvas
        if (top > 1 && top < canvas.height - 1) breaks.push(top)
        if (!el.hasAttribute('data-page-break')) {
          contentBlocks.push({ top, bottom: (r.bottom - areaRect.top) * domToCanvas })
        }
      })
      breaks.push(canvas.height)
      const sortedBreaks = [...new Set(breaks)].sort((a, b) => a - b)
      const hasContentBetween = (a, b) => contentBlocks.some(bl => bl.bottom > a + 1 && bl.top < b - 1)

      // Manual page breaks (with their per-section backgrounds). Each forces a hard page cut.
      const sections = await collectPageSections(area, areaRect, domToCanvas)

      // Walk down the canvas, taking as many whole blocks as fit in a page's usable height.
      // A manual page break forces the page to end at its top; the next page then resumes just
      // after the break band, so the divider itself is never rendered into the PDF. That break's
      // background applies to exactly ONE page — the page that begins right after it (single-page
      // scope) — after which pages revert to the global background.
      const slices = buildSlices(canvas.height, usablePageHeightPx, sortedBreaks, sections, hasContentBetween)

      // Preload the global background once (reused across pages). Full-page canvas at the
      // content's native resolution so text stays crisp when we composite.
      const globalBgImg = bg ? await loadImage(bg.dataUrl) : null
      const pageCanvasW = Math.max(1, Math.round(pxPerMm * pageWidth))
      const pageCanvasH = Math.max(1, Math.round(pxPerMm * pageHeight))

      // Footer page numbers: total = pages actually rendered (skips any degenerate empty slice).
      const pnCfg = { ...PAGE_NUMBER_DEFAULTS, ...(configRef.current.pageNumber || {}) }
      const totalRenderPages = slices.reduce((a, s) => a + ((s.sBottom - s.sTop) > 0 ? 1 : 0), 0)
      let pnPageNo = 0

      // Remember how each slice was placed so charts can be positioned on top of it.
      const placements = []
      for (let i = 0; i < slices.length; i++) {
        const { sTop, sBottom, section } = slices[i]
        const sliceHeightPx = sBottom - sTop
        if (sliceHeightPx <= 0) continue
        pnPageNo += 1

        // Composite the whole page (background + content) into a single flattened JPEG. Embedding
        // one JPEG per page — instead of a full-page PNG background PLUS a transparent PNG content
        // slice on every page — keeps the PDF small enough that jsPDF's string builder doesn't
        // overflow ("Invalid string length") on long/background-heavy reports.
        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = pageCanvasW
        pageCanvas.height = pageCanvasH
        const pctx = pageCanvas.getContext('2d')
        pctx.fillStyle = '#ffffff'
        pctx.fillRect(0, 0, pageCanvasW, pageCanvasH)

        // Page background: a manual section (single page after a break) overrides the global one.
        const bgImg = section
          ? await loadImage(await buildSectionBgDataUrl(section, pageCanvasW, pageCanvasH))
          : globalBgImg
        if (bgImg) pctx.drawImage(bgImg, 0, 0, pageCanvasW, pageCanvasH)

        // Place the content slice inside the page margins (shrinking an oversized lone block).
        let drawW = contentWidthMm
        let drawH = sliceHeightPx / pxPerMm
        if (drawH > contentHeightMm) {
          drawW = contentWidthMm * (contentHeightMm / drawH)
          drawH = contentHeightMm
        }
        const xMm = marginX + (contentWidthMm - drawW) / 2
        pctx.drawImage(canvas, 0, sTop, canvas.width, sliceHeightPx,
          xMm * pxPerMm, marginY * pxPerMm, drawW * pxPerMm, drawH * pxPerMm)

        // Footer page number, painted into the bottom margin at the export's pixel scale.
        if (pnCfg.enabled) {
          drawPageNumberOnCanvas(pctx, pnPageNo, totalRenderPages, pnCfg, { pxPerMm, pageWidth, pageHeight, marginX, marginY })
        }

        const pageImg = pageCanvas.toDataURL('image/jpeg', 0.92)
        if (i > 0) pdf.addPage()
        pdf.addImage(pageImg, 'JPEG', 0, 0, pageWidth, pageHeight)
        // The page (1-based) this slice landed on, plus the scale used (content is shrunk only
        // for an oversized lone block) so chart positions match the raster exactly.
        placements.push({ pageNo: pdf.getNumberOfPages(), sTop, sBottom, x: xMm, scale: drawW / contentWidthMm })
      }

      // Detects any Arabic / RTL script (base block, supplements, presentation forms). svg2pdf
      // can't shape or bidi-order such text, so those charts fall back to a high-res image that
      // the browser shapes correctly. Pure-Latin charts stay true vector for infinite zoom.
      const RTL_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/
      // 2x is plenty sharp for a chart; 4x quadrupled the pixels for no visible gain and, with
      // the raw (uncompressed) PNG storage below, made the file enormous.
      const RASTER_PIXEL_RATIO = 2

      // Overlay each chart on the page its card was rastered into.
      const domToCanvasX = canvas.width / areaRect.width
      for (const el of exportCharts) {
        const entry = chartExportRegistry.get(Number(el.dataset.chartExportKey))
        if (!entry?.option) continue
        const r = el.getBoundingClientRect()
        const cTop = (r.top - areaRect.top) * domToCanvas
        const cLeft = (r.left - areaRect.left) * domToCanvasX
        const cW = r.width * domToCanvasX
        const cH = r.height * domToCanvas
        // The slice (page) whose vertical range contains this chart's top.
        const p = placements.find(pl => cTop >= pl.sTop - 1 && cTop < pl.sBottom - 0.5) || placements[placements.length - 1]
        if (!p) continue

        const pageX = p.x + (cLeft / pxPerMm) * p.scale
        const pageY = marginY + ((cTop - p.sTop) / pxPerMm) * p.scale
        const pageW = (cW / pxPerMm) * p.scale
        const pageH = (cH / pxPerMm) * p.scale
        const w = Math.max(1, Math.round(r.width))
        const h = Math.max(1, Math.round(r.height))

        // The already-mounted ECharts instance is laid out exactly as it looks on screen and in
        // the preview. Re-rendering the option in a fresh instance can drift (title/plot shift up,
        // blank space at the bottom), so export the LIVE instance straight to a high-res image —
        // WYSIWYG with the editor. Fall back to re-rendering only if the instance can't be found.
        const liveDom = el.querySelector('[_echarts_instance_]')
        const liveInst = liveDom ? echarts.getInstanceByDom(liveDom) : null

        try {
          if (liveInst) {
            const dataUrl = liveInst.getDataURL({ type: 'png', pixelRatio: RASTER_PIXEL_RATIO, backgroundColor: 'transparent' })
            pdf.setPage(p.pageNo)
            // 'FAST' => Flate-compress the image stream so a high-res chart doesn't bloat the PDF.
            pdf.addImage(dataUrl, 'PNG', pageX, pageY, pageW, pageH, undefined, 'FAST')
          } else if (RTL_RE.test(JSON.stringify(entry.option))) {
            // Arabic chart: render to a high-resolution PNG (browser shapes the text) and place
            // it as an image. Needs a sized, on-page container for the canvas renderer.
            const host = document.createElement('div')
            host.style.cssText = `position:absolute;left:-99999px;top:0;width:${w}px;height:${h}px;`
            document.body.appendChild(host)
            const inst = echarts.init(host, null, { renderer: 'canvas' })
            try {
              inst.setOption({ ...entry.option, animation: false })
              const dataUrl = inst.getDataURL({ type: 'png', pixelRatio: RASTER_PIXEL_RATIO, backgroundColor: 'transparent' })
              pdf.setPage(p.pageNo)
              // 'FAST' => Flate-compress the image stream. Without it jsPDF stores the chart's
              // pixels RAW, which is what ballooned a 12-page report to hundreds of MB.
              pdf.addImage(dataUrl, 'PNG', pageX, pageY, pageW, pageH, undefined, 'FAST')
            } finally {
              inst.dispose()
              document.body.removeChild(host)
            }
          } else {
            // Latin-only chart: re-render the exact option to an SVG string and draw it as true
            // vector. svg2pdf needs the node in the document to read layout/computed styles.
            const inst = echarts.init(null, null, { renderer: 'svg', ssr: true, width: w, height: h })
            inst.setOption({ ...entry.option, animation: false })
            const svgStr = inst.renderToSVGString()
            inst.dispose()
            const svgEl = new DOMParser().parseFromString(svgStr, 'image/svg+xml').documentElement
            // The editor's canvas renderer clips anything drawn past the chart box (e.g. a long
            // title). The SVG renderer doesn't, so such content would spill outside the chart's
            // frame in the PDF. Clip the SVG to the chart bounds to match the on-screen chart.
            const SVG_NS = 'http://www.w3.org/2000/svg'
            const clipId = `chart-clip-${el.dataset.chartExportKey}`
            const clipPathEl = document.createElementNS(SVG_NS, 'clipPath')
            clipPathEl.setAttribute('id', clipId)
            const clipRect = document.createElementNS(SVG_NS, 'rect')
            clipRect.setAttribute('x', '0')
            clipRect.setAttribute('y', '0')
            clipRect.setAttribute('width', String(w))
            clipRect.setAttribute('height', String(h))
            clipPathEl.appendChild(clipRect)
            const clipGroup = document.createElementNS(SVG_NS, 'g')
            clipGroup.setAttribute('clip-path', `url(#${clipId})`)
            while (svgEl.firstChild) clipGroup.appendChild(svgEl.firstChild)
            svgEl.appendChild(clipPathEl)
            svgEl.appendChild(clipGroup)
            const host = document.createElement('div')
            host.style.cssText = 'position:absolute;left:-99999px;top:0;'
            host.appendChild(svgEl)
            document.body.appendChild(host)
            try {
              pdf.setPage(p.pageNo)
              await svg2pdf(svgEl, pdf, { x: pageX, y: pageY, width: pageW, height: pageH })
            } finally {
              document.body.removeChild(host)
            }
          }
        } catch (e) {
          console.error('Failed to render chart into PDF, leaving its space blank:', e)
        }
      }

      const fileName = `${(title || 'report').trim() || 'report'}.pdf`
      pdf.save(fileName)
    } catch (err) {
      console.error('Failed to export PDF:', err)
      alert('تعذّر تصدير ملف PDF')
    } finally {
      setExporting(false)
      // Hide the report title again (it was kept shown through all the position measurements).
      if (printTitleRef.current) printTitleRef.current.style.display = ''
      // Resume and restore the live pagination spacers stripped for the capture.
      paginationSuspendedRef.current = false
      requestAnimationFrame(() => computePagination())
    }
  }

  // Build an on-screen preview of how the report will be paginated into A4 pages BEFORE
  // exporting. It reuses the exact same capture + block-aware page-slicing logic as the PDF
  // export (so page breaks match), then composites each slice onto a full A4 page canvas with
  // the chosen background + margins. Charts are shown as their live rasterized graphic here
  // (the crisp vector/hi-res redraw only happens in the real export).
  const handlePreview = async () => {
    const area = document.getElementById('report-print-area')
    if (!area || previewLoading || exporting) return

    setPreviewLoading(true)
    try {
      const { default: html2canvas } = await import('html2canvas-pro')

      // Strip the live pagination spacers for the capture (the preview paginates the gapless
      // content itself, exactly like the export); restored in `finally`.
      paginationSuspendedRef.current = true
      editor?.view?.dispatch(editor.view.state.tr.setMeta(paginationKey, DecorationSet.empty))
      paginationSigRef.current = ''
      paginationIterRef.current = 0

      // Force lazy charts to finish drawing so they appear in the capture.
      window.dispatchEvent(new Event('chart-force-load'))
      await waitForCharts(area)

      // Inline cross-origin body images to base64 so they render in the capture (restored below).
      const restoreImages = await inlineImagesForCapture(area)

      const bg = await resolveBackgroundDataUrl()

      // Show the title and strip the on-screen card frame / CSS background, exactly like export.
      if (printTitleRef.current) printTitleRef.current.style.display = 'block'
      const prevAreaBg = area.style.backgroundColor
      const prevAreaBgImage = area.style.backgroundImage
      const prevAreaBorder = area.style.border
      const prevAreaRadius = area.style.borderRadius
      const prevAreaShadow = area.style.boxShadow
      area.style.backgroundColor = 'transparent'
      area.style.backgroundImage = 'none'
      area.style.border = 'none'
      area.style.borderRadius = '0'
      area.style.boxShadow = 'none'

      // Hide the editor-only page-break dividers during capture (box still reserves its space).
      const pbEls = Array.from(area.querySelectorAll('.ProseMirror > [data-page-break]'))
      const prevPbVis = pbEls.map(el => el.style.visibility)
      pbEls.forEach(el => { el.style.visibility = 'hidden' })

      let canvas
      try {
        canvas = await html2canvas(area, {
          scale: 2,
          useCORS: true,
          backgroundColor: bg ? null : '#ffffff',
        })
      } finally {
        // Keep the title shown through the position measurements below (it's in `canvas`), so the
        // preview paginates on the same coordinates as the export. Hidden in the outer finally.
        area.style.backgroundColor = prevAreaBg
        area.style.backgroundImage = prevAreaBgImage
        area.style.border = prevAreaBorder
        area.style.borderRadius = prevAreaRadius
        area.style.boxShadow = prevAreaShadow
        pbEls.forEach((el, idx) => { el.style.visibility = prevPbVis[idx] })
        restoreImages()
      }

      // A4 geometry — mirrors handleExportPdf.
      const PAGE_W_MM = 210
      const PAGE_H_MM = 297
      const marginX = pagePaddingX
      const marginY = pagePaddingY
      const contentWidthMm = PAGE_W_MM - marginX * 2
      const contentHeightMm = PAGE_H_MM - marginY * 2
      const pxPerMm = canvas.width / contentWidthMm
      const usablePageHeightPx = contentHeightMm * pxPerMm

      // Break candidates: the top edge of every top-level block, so no block is split.
      const areaRect = area.getBoundingClientRect()
      const domToCanvas = canvas.height / areaRect.height
      const breaks = [0]
      const contentBlocks = []
      area.querySelectorAll('.ProseMirror > *').forEach((el) => {
        const r = el.getBoundingClientRect()
        const top = (r.top - areaRect.top) * domToCanvas
        if (top > 1 && top < canvas.height - 1) breaks.push(top)
        if (!el.hasAttribute('data-page-break')) {
          contentBlocks.push({ top, bottom: (r.bottom - areaRect.top) * domToCanvas })
        }
      })
      breaks.push(canvas.height)
      const sortedBreaks = [...new Set(breaks)].sort((a, b) => a - b)
      const hasContentBetween = (a, b) => contentBlocks.some(bl => bl.bottom > a + 1 && bl.top < b - 1)

      // Manual page breaks (with their per-section backgrounds) — identical logic to export.
      const sections = await collectPageSections(area, areaRect, domToCanvas)

      // Same block-aware, page-break-aware slicing as the export.
      const slices = buildSlices(canvas.height, usablePageHeightPx, sortedBreaks, sections, hasContentBetween)

      // Composite each slice onto a full A4 page canvas (background + centered content).
      const pageCanvasW = Math.round(PAGE_W_MM * pxPerMm)
      const pageCanvasH = Math.round(PAGE_H_MM * pxPerMm)
      const contentWidthPx = contentWidthMm * pxPerMm
      const contentHeightPx = contentHeightMm * pxPerMm
      const bgImg = bg ? await loadImage(bg.dataUrl) : null

      const pnCfg = { ...PAGE_NUMBER_DEFAULTS, ...(configRef.current.pageNumber || {}) }
      let pnPageNo = 0

      const pages = []
      for (const { sTop, sBottom, section } of slices) {
        pnPageNo += 1
        const sliceHeightPx = sBottom - sTop
        const pc = document.createElement('canvas')
        pc.width = pageCanvasW
        pc.height = pageCanvasH
        const ctx = pc.getContext('2d')
        // White paper base, then background across the whole page — a manual section (the single
        // page after a break) overrides the global one.
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, pageCanvasW, pageCanvasH)
        if (section) {
          const secUrl = await buildSectionBgDataUrl(section, pageCanvasW, pageCanvasH)
          ctx.drawImage(await loadImage(secUrl), 0, 0, pageCanvasW, pageCanvasH)
        } else if (bgImg) {
          ctx.drawImage(bgImg, 0, 0, pageCanvasW, pageCanvasH)
        }
        // Place the content slice inside the margins, shrinking an oversized lone block to fit.
        let drawW = contentWidthPx
        let drawH = sliceHeightPx
        if (drawH > contentHeightPx) {
          drawW = contentWidthPx * (contentHeightPx / drawH)
          drawH = contentHeightPx
        }
        const x = marginX * pxPerMm + (contentWidthPx - drawW) / 2
        const y = marginY * pxPerMm
        ctx.drawImage(canvas, 0, sTop, canvas.width, sliceHeightPx, x, y, drawW, drawH)
        if (pnCfg.enabled) {
          drawPageNumberOnCanvas(ctx, pnPageNo, slices.length, pnCfg, { pxPerMm, pageWidth: PAGE_W_MM, pageHeight: PAGE_H_MM, marginX, marginY })
        }
        pages.push(pc.toDataURL('image/jpeg', 0.9))
      }

      setPreviewPages(pages)
      setShowPreview(true)
    } catch (err) {
      console.error('Failed to build preview:', err)
      alert('تعذّر إنشاء المعاينة')
    } finally {
      setPreviewLoading(false)
      // Hide the report title again (kept shown through the position measurements).
      if (printTitleRef.current) printTitleRef.current.style.display = ''
      // Resume and restore the live pagination spacers stripped for the capture.
      paginationSuspendedRef.current = false
      requestAnimationFrame(() => computePagination())
    }
  }

  const addImage = () => {
    fileInputRef.current?.click()
  }

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !editor) return
    try {
      const res = await apiUpload('/api/reports/upload-image', file)
      if (res.status === 'success') {
        editor.chain().focus().setImage({ src: res.data.url }).run()
      }
    } catch (err) {
      console.error('Failed to upload image:', err)
      alert('فشل رفع الصورة')
    }
    e.target.value = ''
  }

  const handleColorChange = (e) => {
    if (editor) {
      editor.chain().focus().setColor(e.target.value).run()
    }
  }

  const handleHighlightChange = (e) => {
    if (editor) {
      editor.chain().focus().toggleHighlight({ color: e.target.value }).run()
    }
  }

  const addChart = () => {
    setShowChartPicker(true)
  }

  // A chart in a tree is created at a drill-down level (e.g. "age" under gender=male). Its
  // data context is the breadcrumb filter of that level merged with the tree's column filters.
  // Resolve it here so the report fetches the SAME filtered slice, not the whole column.
  const resolveChartFilters = (structure, chart) => {
    if (!chart) return {}
    const columnFilters = structure?.column_filters || {}
    // Prefer the filter stored on the chart itself (reliable). Older charts without it fall
    // back to looking up their level in whatever breadcrumb path the tree happens to have saved.
    if (chart.filter && Object.keys(chart.filter).length) {
      return { ...columnFilters, ...chart.filter }
    }
    const breadcrumbs = structure?.breadcrumbs || []
    const levelFilter = breadcrumbs.find(b => b.id === chart.levelId)?.filter || {}
    return { ...columnFilters, ...levelFilter }
  }

  const handleChartSelect = ({ tree, chart }) => {
    if (editor) {
      const chartConfig = {
        id: chart.id,
        x: chart.x,
        y: chart.y || '',
        type: chart.type || 'bar',
        title: chart.title || '',
        themeColor: chart.themeColor || '#054239',
        fontSize: chart.fontSize || 14,
        fontFamily: chart.fontFamily || 'Cairo, sans-serif',
        chartWidth: chart.chartWidth || 'md:col-span-1',
        chartHeight: chart.chartHeight || '350px',
        barWidth: chart.barWidth || 50,
        colorMode: chart.colorMode || 'single',
        customCategoryColors: chart.customCategoryColors || null,
        levelId: chart.levelId || null,
        filter: chart.filter || {}, // raw drill-down filter persisted on the chart (source of truth)
        filters: resolveChartFilters(tree.structure, chart), // resolved payload sent to /api/chart-data
      }
      editor.chain().focus().insertContent({
        type: 'chartNode',
        attrs: {
          chartTreeId: tree.id,
          chartId: chart.id,
          fileId: tree.file_id,
          chartConfig,
          chartData: null,
        },
      }).run()
      setShowChartPicker(false)
    }
  }

  const addTable = () => {
    setShowTablePopover(true)
  }

  const handleInsertTable = () => {
    if (editor) {
      editor.chain().focus().insertTable({ rows: tableRows, cols: tableCols, withHeaderRow: tableHeader }).run()
      setShowTablePopover(false)
      setTableRows(3)
      setTableCols(3)
    }
  }

  // Insert a manual page break. It forces a new page here on export/preview and lets the user
  // give this page (and the pages after it, up to the next break) its own background.
  const addPageBreak = () => {
    if (editor) {
      editor.chain().focus().insertContent({ type: 'pageBreak' }).run()
    }
  }

  if (!editor) return null

  const ToolbarButton = ({ onClick, active, children, title }) => (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg transition-colors ${active ? 'bg-[#054239] text-white' : 'text-gray-600 hover:bg-gray-100'}`}
    >
      {children}
    </button>
  )

  return (
    <div className="max-w-5xl mx-auto" dir="rtl">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageUpload}
        accept="image/*"
        className="hidden"
      />
      <input
        type="file"
        ref={bgInputRef}
        onChange={handleBgUpload}
        accept="image/*"
        className="hidden"
      />
      <input
        type="color"
        ref={colorInputRef}
        onChange={handleColorChange}
        className="hidden"
      />
      <input
        type="color"
        ref={highlightInputRef}
        onChange={handleHighlightChange}
        className="hidden"
      />
      {showFontManager && (
        <FontManager
          isAdmin={isAdmin}
          onFontAdded={onFontAdded}
          onClose={() => setShowFontManager(false)}
        />
      )}
      {showChartPicker && (
        <ChartPickerModal
          projectId={project?.id || report.project_id}
          onSelect={handleChartSelect}
          onClose={() => setShowChartPicker(false)}
        />
      )}

      {showPreview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex flex-col" onClick={() => setShowPreview(false)}>
          <div className="bg-white/95 backdrop-blur px-6 py-3 flex items-center justify-between shadow" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-[#002623]">
              <Eye className="w-5 h-5" />
              <span className="font-bold text-sm">معاينة الصفحات</span>
              <span className="text-xs text-gray-500">
                ({previewPages.length} {previewPages.length === 1 ? 'صفحة' : 'صفحات'})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setShowPreview(false); handleExportPdf() }}
                disabled={exporting}
                className="flex items-center gap-1 bg-[#054239] hover:bg-[#002623] text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-60"
              >
                <FileDown className="w-3.5 h-3.5" /> تصدير PDF
              </button>
              <button onClick={() => setShowPreview(false)} className="text-gray-500 hover:text-gray-800 p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto py-8 px-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col items-center gap-8">
              {previewPages.map((src, i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <img
                    src={src}
                    alt={`صفحة ${i + 1}`}
                    className="bg-white shadow-2xl"
                    style={{ width: 'min(794px, 90vw)', aspectRatio: '210 / 297' }}
                  />
                  <span className="text-white/80 text-xs font-medium">
                    صفحة {i + 1} من {previewPages.length}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-500 hover:text-gray-700 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-lg font-bold text-[#002623] bg-transparent border-none focus:outline-none focus:ring-0 w-64"
            placeholder="عنوان التقرير"
          />
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-gray-400">جاري الحفظ...</span>}
          {saved && !saving && <span className="text-xs text-green-600">تم الحفظ</span>}
          <button onClick={handleManualSave} className="flex items-center gap-1 bg-[#054239] hover:bg-[#002623] text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all">
            <Save className="w-3.5 h-3.5" /> حفظ
          </button>
          <button onClick={handlePreview} disabled={previewLoading || exporting} className="flex items-center gap-1 bg-white border border-[#054239] text-[#054239] hover:bg-[#054239] hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed" title="معاينة توزيع الصفحات قبل التصدير">
            <Eye className="w-3.5 h-3.5" /> {previewLoading ? 'جاري المعاينة...' : 'معاينة الصفحات'}
          </button>
          <button onClick={handleExportPdf} disabled={exporting} className="flex items-center gap-1 bg-white border border-[#054239] text-[#054239] hover:bg-[#054239] hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed">
            <FileDown className="w-3.5 h-3.5" /> {exporting ? 'جاري التصدير...' : 'تصدير PDF'}
          </button>
        </div>
      </div>

      <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center gap-1 flex-wrap sticky top-[57px] z-10 shadow-sm">
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="عريض">
          <Bold className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="مائل">
          <Italic className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="تسطير">
          <UnderlineIcon className="w-4 h-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-gray-200 mx-1" />
        <select
          value={editor.getAttributes('textStyle').fontSize || ''}
          onChange={(e) => {
            const v = e.target.value
            if (v) editor.chain().focus().setFontSize(v).run()
            else editor.chain().focus().unsetFontSize().run()
          }}
          className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-700"
          title="حجم الخط"
        >
          <option value="">حجم الخط</option>
          {[12, 14, 16, 18, 20, 24, 28, 32, 40, 48].map(s => (
            <option key={s} value={`${s}px`}>{s}</option>
          ))}
        </select>
        <div className="w-px h-5 bg-gray-200 mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="قائمة نقطية">
          <List className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="قائمة مرقمة">
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-gray-200 mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="محاذاة يمين">
          <AlignRight className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="توسيط">
          <AlignCenter className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="محاذاة يسار">
          <AlignLeft className="w-4 h-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-gray-200 mx-1" />
        <select
          value={editor.getAttributes('textStyle').fontFamily || ''}
          onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
          className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white text-gray-700 max-w-[110px]"
          title="نوع الخط"
        >
          <option value="">الخط الافتراضي</option>
          {fonts.map(f => (
            <option key={f.id} value={f.font_family}>{f.name}</option>
          ))}
        </select>
        <button
          onClick={() => setShowFontManager(true)}
          className="p-1 text-gray-500 hover:text-[#054239] transition-colors"
          title="إدارة الخطوط"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-5 bg-gray-200 mx-1" />
        <ToolbarButton onClick={() => colorInputRef.current?.click()} title="لون النص">
          <Palette className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => highlightInputRef.current?.click()} active={editor.isActive('highlight')} title="تظليل">
          <Highlighter className="w-4 h-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-gray-200 mx-1" />
        <ToolbarButton onClick={addImage} title="إدراج صورة">
          <Image className="w-4 h-4" />
        </ToolbarButton>
        <div className="relative">
          <ToolbarButton onClick={addTable} active={showTablePopover} title="إدراج جدول">
            <TableIcon className="w-4 h-4" />
          </ToolbarButton>
          {showTablePopover && (
            <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded-xl shadow-lg p-4 z-30 w-56" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-[#054239]">إدراج جدول</span>
                <button onClick={() => setShowTablePopover(false)} className="text-gray-400 hover:text-gray-700">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-600 block mb-1">عدد الأعمدة</label>
                  <input type="number" min="1" max="20" value={tableCols}
                    onChange={(e) => setTableCols(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-center" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 block mb-1">عدد الصفوف</label>
                  <input type="number" min="1" max="50" value={tableRows}
                    onChange={(e) => setTableRows(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-center" />
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={tableHeader} onChange={(e) => setTableHeader(e.target.checked)} className="rounded" />
                  صف عناوين
                </label>
                <button onClick={handleInsertTable}
                  className="w-full bg-[#054239] hover:bg-[#002623] text-white text-xs font-bold py-2 rounded-lg transition-colors">
                  إنشاء
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="relative">
          <ToolbarButton onClick={() => setShowBgPanel(v => !v)} active={showBgPanel || !!backgroundUrl} title="خلفية صفحة التصدير (PDF)">
            <Images className="w-4 h-4" />
          </ToolbarButton>
          {showBgPanel && (
            <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded-xl shadow-lg p-4 z-30 w-72" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-[#054239]">خلفية صفحات الـ PDF</span>
                <button onClick={() => setShowBgPanel(false)} className="text-gray-400 hover:text-gray-700">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-gray-500 mb-2">قوالب جاهزة</p>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {BG_TEMPLATES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => applyBackground(TEMPLATE_PREFIX + t.id)}
                    title={t.name}
                    className={`relative aspect-[3/4] rounded-lg border-2 overflow-hidden bg-white transition-all ${backgroundUrl === TEMPLATE_PREFIX + t.id ? 'border-[#054239] ring-1 ring-[#054239]' : 'border-gray-200 hover:border-[#428177]'}`}
                  >
                    <img src={t.url} alt={t.name} className="w-full h-full object-cover" />
                    {backgroundUrl === TEMPLATE_PREFIX + t.id && (
                      <span className="absolute top-1 left-1 bg-[#054239] text-white rounded-full p-0.5">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => bgInputRef.current?.click()}
                  disabled={uploadingBg}
                  className="flex-1 flex items-center justify-center gap-1 bg-[#054239] hover:bg-[#002623] text-white text-xs font-bold py-2 rounded-lg transition-colors disabled:opacity-60"
                >
                  <UploadIcon className="w-3.5 h-3.5" /> {uploadingBg ? 'جاري الرفع...' : 'رفع صورة'}
                </button>
                <button
                  onClick={() => applyBackground(null)}
                  disabled={!backgroundUrl}
                  className="flex items-center justify-center gap-1 border border-gray-300 text-gray-600 hover:bg-gray-50 text-xs font-bold py-2 px-3 rounded-lg transition-colors disabled:opacity-40"
                  title="بدون خلفية"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {backgroundUrl && !backgroundUrl.startsWith(TEMPLATE_PREFIX) && (
                <div className="mt-3">
                  <p className="text-[11px] text-gray-500 mb-1">الخلفية الحالية</p>
                  <img src={resolvedBg} alt="الخلفية" className="w-full h-20 object-cover rounded-lg border border-gray-200" />
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-[11px] text-gray-500 mb-2">هوامش الطباعة (مم)</p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-[11px] text-gray-600">
                    أفقي (X)
                    <input
                      type="number" min="0" max="60" value={pagePaddingX}
                      onChange={(e) => applyPadding('pagePaddingX', e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm text-center" />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-gray-600">
                    رأسي (Y)
                    <input
                      type="number" min="0" max="60" value={pagePaddingY}
                      onChange={(e) => applyPadding('pagePaddingY', e.target.value)}
                      className="border border-gray-300 rounded-lg px-2 py-1 text-sm text-center" />
                  </label>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">0 = الخلفية تملأ الصفحة بالكامل بلا إطار أبيض. زِد القيمة لإبعاد النص عن إطار القالب.</p>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100">
                <label className="flex items-center justify-between text-[11px] font-bold text-gray-600 cursor-pointer">
                  أرقام الصفحات (تذييل)
                  <input
                    type="checkbox"
                    checked={pageNum.enabled}
                    onChange={(e) => applyPageNumber({ enabled: e.target.checked })}
                    className="accent-[#054239] w-4 h-4"
                  />
                </label>
                {pageNum.enabled && (
                  <div className="mt-2 space-y-2">
                    <div>
                      <p className="text-[11px] text-gray-500 mb-1">الموضع</p>
                      <div className="grid grid-cols-3 gap-1">
                        {[['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']].map(([val, label]) => (
                          <button
                            key={val}
                            onClick={() => applyPageNumber({ align: val })}
                            className={`text-[11px] py-1 rounded-lg border font-bold transition-colors ${pageNum.align === val ? 'bg-[#054239] text-white border-[#054239]' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-[11px] text-gray-600">
                        اللون
                        <input
                          type="color"
                          value={pageNum.color}
                          onChange={(e) => applyPageNumber({ color: e.target.value })}
                          className="h-8 w-full rounded border cursor-pointer"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-gray-600">
                        الحجم (pt)
                        <input
                          type="number" min="6" max="48" value={pageNum.size}
                          onChange={(e) => applyPageNumber({ size: Math.max(6, Math.min(48, Math.round(Number(e.target.value) || 11))) })}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm text-center"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1 text-[11px] text-gray-600">
                      الخط
                      <select
                        value={pageNum.font}
                        onChange={(e) => applyPageNumber({ font: e.target.value })}
                        className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                      >
                        <option value="">الخط الافتراضي</option>
                        {fonts.map(f => <option key={f.id} value={f.font_family}>{f.name}</option>)}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-[11px] text-gray-600">
                        الصيغة
                        <select
                          value={pageNum.format}
                          onChange={(e) => applyPageNumber({ format: e.target.value })}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                        >
                          <option value="plain">1</option>
                          <option value="withTotal">1 / 5</option>
                          <option value="arabic">صفحة 1 من 5</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-gray-600">
                        الأرقام
                        <select
                          value={pageNum.numerals}
                          onChange={(e) => applyPageNumber({ numerals: e.target.value })}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                        >
                          <option value="latin">123</option>
                          <option value="arabic">١٢٣</option>
                        </select>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {!isTemplate && (
          <ToolbarButton onClick={addChart} title="إدراج مخطط">
            <ChartBarBig className="w-4 h-4" />
          </ToolbarButton>
        )}
        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="خط أفقي">
          <Minus className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={addPageBreak} title="فاصل صفحة (خلفية مخصصة للصفحة)">
          <SeparatorHorizontal className="w-4 h-4" />
        </ToolbarButton>
        <div className="w-px h-5 bg-gray-200 mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="تراجع">
          <Undo2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="إعادة">
          <Redo2 className="w-4 h-4" />
        </ToolbarButton>
      </div>

      {tableToolbarPos && (
        <div
          className="table-float-toolbar"
          style={{
            position: 'fixed',
            top: tableToolbarPos.top - 44 + 'px',
            left: tableToolbarPos.left + 'px',
            transform: 'translateX(-50%)',
          }}
        >
          <button onClick={() => editor.chain().focus().addColumnAfter().run()} title="إضافة عمود">
            <span className="text-xs font-bold">عمود+</span>
          </button>
          <span className="sep" />
          <button onClick={() => editor.chain().focus().addRowAfter().run()} title="إضافة صف">
            <span className="text-xs font-bold">صف+</span>
          </button>
          <span className="sep" />
          <button onClick={() => editor.chain().focus().deleteTable().run()} className="del" title="حذف الجدول">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {/* The outer "page" carries the print margins as padding, so the content is genuinely inset
          — and reflows — exactly as it will in the PDF (WYSIWYG). Padding is a % of the page width
          (210mm), matching the export's margin scaling. The captured element (#report-print-area)
          stays the content only, so the exporter's geometry is unchanged. */}
      <div
        id="report-page"
        className="relative bg-white rounded-b-2xl shadow-sm border-x border-b border-gray-200 mb-8"
        style={{ padding: `${(pagePaddingY / 210) * 100}% ${(pagePaddingX / 210) * 100}%` }}
      >
        {/* Per-page background layer: one full-page tile per A4 page, so the background repeats on
            every page and fills the margins around the inset content (like the exported page).
            Lives outside the captured element, which composites its own background per page. */}
        <div className="page-backgrounds" aria-hidden="true" data-html2canvas-ignore="true">
          {pageBgRegions.map((r, i) => (
            <div
              key={i}
              className="page-bg-tile"
              style={{
                top: `${r.top}px`,
                height: `${pageHeightScreen}px`,
                opacity: r.opacity,
                backgroundColor: r.color || undefined,
                backgroundImage: r.src ? `url("${r.src}")` : undefined,
                backgroundSize: r.src ? '100% 100%' : undefined,
                backgroundRepeat: 'no-repeat',
              }}
            />
          ))}
        </div>
        {/* Footer page numbers — one per page, placed in the bottom margin band. Editor-only (the
            export/preview paint their own), so it stays out of the captured content. */}
        {pageNum.enabled && pageHeightScreen > 0 && pageBgRegions.length > 0 && (() => {
          const mmToPx = pageHeightScreen / 297
          const marginXpx = pagePaddingX * mmToPx
          const offsetPx = Math.min(pagePaddingY, Math.max(pagePaddingY / 2, 4)) * mmToPx
          const fontPx = pageNum.size * (25.4 / 72) * mmToPx
          const total = pageBgRegions.length
          return (
            <div className="page-numbers" aria-hidden="true" data-html2canvas-ignore="true">
              {pageBgRegions.map((_, i) => (
                <div
                  key={i}
                  className="page-number"
                  style={{
                    top: `${(i + 1) * pageHeightScreen - offsetPx}px`,
                    left: `${marginXpx}px`,
                    right: `${marginXpx}px`,
                    transform: 'translateY(-50%)',
                    textAlign: pageNum.align,
                    color: pageNum.color,
                    fontFamily: pageNum.font || undefined,
                    fontSize: `${fontPx}px`,
                  }}
                >
                  {formatPageNumber(i + 1, total, pageNum)}
                </div>
              ))}
            </div>
          )
        })()}
        <div id="report-print-area" className="relative z-[1]">
          <h1 ref={printTitleRef} className="hidden text-2xl font-bold text-center text-[#002623] pt-6">{title}</h1>
          <EditorContent editor={editor} className="min-h-[600px]" />
          {/* Live page boundary markers: an "end" line at each page's content bottom and a "start"
              line at the next page's content top, with the empty margin band between them. Editor-
              only: data-html2canvas-ignore keeps them out of capture, pointer-events:none keeps
              them from blocking editing. */}
          <div className="page-guides" aria-hidden="true" data-html2canvas-ignore="true">
            {pageGuides.map((g, i) => (
              <React.Fragment key={i}>
                <div className="page-guide page-guide-end" style={{ top: `${g.end}px` }}>
                  <span className="page-guide-label">نهاية صفحة {g.page}</span>
                </div>
                <div className="page-guide page-guide-start" style={{ top: `${g.start}px` }}>
                  <span className="page-guide-label">بداية صفحة {g.page + 1}</span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}