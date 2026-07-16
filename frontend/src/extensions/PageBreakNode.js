import { Node, mergeAttributes } from '@tiptap/core'
import { BG_TEMPLATES, TEMPLATE_PREFIX, resolveBgSrc, hexToRgba } from '../lib/reportBackgrounds'

// A manual page break. Forces the export/preview to start a fresh page at this point, and
// carries an optional background (template or uploaded image, a solid color, and an opacity)
// that applies to that page and every page after it until the next page break. The section's
// config is mirrored onto the DOM element as data-* attributes so the exporter can read it
// straight from the captured layout (see ReportEditor export/preview).
const PageBreakNode = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      bgImage: { default: null },   // 'tmpl:<id>' or an uploaded image URL
      bgColor: { default: null },   // '#rrggbb'
      bgOpacity: { default: 1 },    // 0..1, applied to both color and image
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '' })]
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const attrs = () => node.attrs

      const container = document.createElement('div')
      container.setAttribute('data-page-break', '')
      container.contentEditable = 'false'
      container.className = 'page-break-node relative my-4 select-none'

      // Reflect the current background config onto the DOM so the exporter can read it.
      const syncDataAttrs = () => {
        const a = attrs()
        if (a.bgImage) container.setAttribute('data-bg-image', a.bgImage)
        else container.removeAttribute('data-bg-image')
        if (a.bgColor) container.setAttribute('data-bg-color', a.bgColor)
        else container.removeAttribute('data-bg-color')
        container.setAttribute('data-bg-opacity', String(a.bgOpacity ?? 1))
      }
      syncDataAttrs()

      // The visible divider: a dashed line, a label, and a tiny swatch previewing the section
      // background. A gear button toggles the settings panel.
      const bar = document.createElement('div')
      bar.className = 'flex items-center gap-2'
      bar.innerHTML = `
        <div class="flex-1 border-t-2 border-dashed border-[#988561]"></div>
        <div class="flex items-center gap-2 bg-[#f5f2ea] border border-[#988561]/40 rounded-full px-3 py-1">
          <span class="bg-swatch inline-block w-4 h-4 rounded border border-gray-300"></span>
          <span class="text-xs font-bold text-[#054239]">فاصل صفحة</span>
          <button class="settings-btn text-[#054239] hover:text-[#988561] transition-colors" title="خلفية الصفحة">⚙</button>
          <button class="delete-btn text-gray-400 hover:text-red-500 transition-colors font-bold leading-none" title="حذف فاصل الصفحة">✕</button>
        </div>
        <div class="flex-1 border-t-2 border-dashed border-[#988561]"></div>
      `
      container.appendChild(bar)

      bar.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation()
        if (typeof getPos !== 'function') return
        const pos = getPos()
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
      })

      const swatch = bar.querySelector('.bg-swatch')
      const updateSwatch = () => {
        const a = attrs()
        const src = resolveBgSrc(a.bgImage)
        if (src) {
          swatch.style.backgroundImage = `url("${src}")`
          swatch.style.backgroundSize = 'cover'
          swatch.style.backgroundColor = ''
        } else if (a.bgColor) {
          swatch.style.backgroundImage = ''
          swatch.style.backgroundColor = hexToRgba(a.bgColor, a.bgOpacity ?? 1)
        } else {
          swatch.style.backgroundImage = ''
          swatch.style.backgroundColor = '#ffffff'
        }
      }
      updateSwatch()

      // Settings panel (hidden by default).
      const panel = document.createElement('div')
      panel.className = 'page-break-panel hidden absolute z-30 top-9 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-72'
      panel.innerHTML = `
        <div class="text-xs font-bold text-[#054239] mb-2">خلفية هذه الصفحة وما بعدها</div>
        <div class="tmpl-grid grid grid-cols-3 gap-1.5 mb-2"></div>
        <button class="upload-btn bg-[#428177] text-white text-xs px-3 py-1.5 rounded-lg w-full font-bold mb-2">رفع صورة خلفية</button>
        <label class="text-xs block mb-1">لون الخلفية</label>
        <div class="flex items-center gap-2 mb-2">
          <input type="color" class="bg-color-input flex-1 h-8 rounded border cursor-pointer">
          <button class="clear-color-btn text-[11px] text-gray-500 hover:text-red-500">بدون لون</button>
        </div>
        <label class="text-xs block mb-1">شفافية الخلفية: <span class="opacity-val">100%</span></label>
        <input type="range" class="bg-opacity-input w-full mb-2" min="0" max="100" step="5">
        <button class="clear-btn bg-gray-100 text-gray-700 text-xs px-3 py-1.5 rounded-lg w-full font-bold">بدون خلفية</button>
        <input type="file" accept="image/*" class="upload-input hidden">
      `
      container.appendChild(panel)

      let open = false
      bar.querySelector('.settings-btn').addEventListener('click', (e) => {
        e.stopPropagation()
        open = !open
        panel.classList.toggle('hidden', !open)
      })

      const setAttrs = (changes) => {
        const chain = editor.chain().focus()
        if (typeof getPos === 'function') chain.setNodeSelection(getPos())
        chain.updateAttributes('pageBreak', changes).run()
        // The node view is recreated on attribute change, so no manual re-render is needed;
        // but update our local visuals immediately for responsiveness.
        updateSwatch()
        syncDataAttrs()
      }

      // Template chooser.
      const grid = panel.querySelector('.tmpl-grid')
      BG_TEMPLATES.forEach(t => {
        const b = document.createElement('button')
        b.className = 'aspect-[3/4] rounded border border-gray-200 hover:border-[#428177] overflow-hidden bg-white'
        b.title = t.name
        b.innerHTML = `<img src="${t.url}" class="w-full h-full object-cover" alt="${t.name}">`
        b.addEventListener('click', () => setAttrs({ bgImage: TEMPLATE_PREFIX + t.id }))
        grid.appendChild(b)
      })

      // Upload image.
      const uploadInput = panel.querySelector('.upload-input')
      panel.querySelector('.upload-btn').addEventListener('click', () => uploadInput.click())
      uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        const btn = panel.querySelector('.upload-btn')
        const prev = btn.textContent
        btn.textContent = 'جارٍ الرفع...'
        try {
          const { apiUpload } = await import('../api')
          const res = await apiUpload('/api/reports/upload-image', file)
          if (res.status === 'success') setAttrs({ bgImage: res.data.url })
          else alert('فشل رفع صورة الخلفية')
        } catch (err) {
          console.error('Page-break bg upload failed', err)
          alert('فشل رفع صورة الخلفية')
        } finally {
          btn.textContent = prev
        }
      })

      // Color + opacity.
      const colorInput = panel.querySelector('.bg-color-input')
      colorInput.value = attrs().bgColor || '#ffffff'
      colorInput.addEventListener('input', () => setAttrs({ bgColor: colorInput.value }))
      panel.querySelector('.clear-color-btn').addEventListener('click', () => setAttrs({ bgColor: null }))

      const opacityInput = panel.querySelector('.bg-opacity-input')
      const opacityVal = panel.querySelector('.opacity-val')
      opacityInput.value = String(Math.round((attrs().bgOpacity ?? 1) * 100))
      opacityVal.textContent = opacityInput.value + '%'
      opacityInput.addEventListener('input', () => {
        opacityVal.textContent = opacityInput.value + '%'
      })
      opacityInput.addEventListener('change', () => {
        setAttrs({ bgOpacity: (parseInt(opacityInput.value, 10) || 0) / 100 })
      })

      panel.querySelector('.clear-btn').addEventListener('click', () => {
        setAttrs({ bgImage: null, bgColor: null, bgOpacity: 1 })
      })

      return {
        dom: container,
        ignoreMutation: () => true,
      }
    }
  },
})

export default PageBreakNode
