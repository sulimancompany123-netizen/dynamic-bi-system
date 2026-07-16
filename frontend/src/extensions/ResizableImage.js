import Image from '@tiptap/extension-image'

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: 400, parseHTML: el => el.getAttribute('width'), renderHTML: attrs => attrs.width ? { width: attrs.width } : {} },
      height: { default: null, parseHTML: el => el.getAttribute('height'), renderHTML: attrs => attrs.height ? { height: attrs.height } : {} },
      alignment: { default: 'center', parseHTML: el => el.getAttribute('data-alignment'), renderHTML: attrs => attrs.alignment ? { 'data-alignment': attrs.alignment } : {} },
      borderRadius: { default: null, parseHTML: el => el.getAttribute('data-border-radius'), renderHTML: attrs => attrs.borderRadius ? { 'data-border-radius': attrs.borderRadius } : {} },
    }
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const wrapper = document.createElement('span')
      wrapper.className = 'image-wrapper'
      wrapper.contentEditable = 'false'

      const img = document.createElement('img')
      img.src = node.attrs.src
      img.setAttribute('width', node.attrs.width || 400)
      if (node.attrs.height) img.setAttribute('height', node.attrs.height)
      img.style.display = 'block'
      img.style.maxWidth = '100%'
      if (node.attrs.borderRadius) img.style.borderRadius = node.attrs.borderRadius + 'px'
      if (node.attrs.alignment) wrapper.setAttribute('data-alignment', node.attrs.alignment)
      img.draggable = true
      wrapper.appendChild(img)

      const handle = document.createElement('div')
      handle.className = 'image-resize-handle'
      wrapper.appendChild(handle)

      let toolbar = null
      let isResizing = false

      const activeBtnClass = 'bg-white/30'

      const makeSvg = (w, h, viewBox, inner) => {
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        s.setAttribute('width', String(w))
        s.setAttribute('height', String(h))
        s.setAttribute('viewBox', viewBox)
        s.setAttribute('fill', 'none')
        s.setAttribute('stroke', 'currentColor')
        s.setAttribute('stroke-width', '2')
        s.setAttribute('stroke-linecap', 'round')
        s.setAttribute('stroke-linejoin', 'round')
        s.innerHTML = inner
        return s
      }

      const showToolbar = () => {
        if (toolbar) return
        toolbar = document.createElement('div')
        toolbar.className = 'image-toolbar'

        const alignments = [
          { value: 'left', label: 'يسار', svg: '<path d="M17 10H3"/><path d="M21 6H3"/><path d="M21 14H3"/><path d="M17 18H3"/>' },
          { value: 'center', label: 'وسط', svg: '<path d="M21 6H3"/><path d="M17 10H7"/><path d="M17 14H7"/><path d="M21 18H3"/>' },
          { value: 'right', label: 'يمين', svg: '<path d="M21 10H7"/><path d="M21 6H3"/><path d="M21 14H3"/><path d="M21 18H7"/>' },
        ]

        alignments.forEach(({ value, label, svg }) => {
          const btn = document.createElement('button')
          btn.title = label
          btn.appendChild(makeSvg(14, 14, '0 0 24 24', svg))
          if (node.attrs.alignment === value) btn.classList.add(activeBtnClass)
          btn.addEventListener('click', (e) => {
            e.stopPropagation()
            wrapper.setAttribute('data-alignment', value)
            const pos = typeof getPos === 'function' ? getPos() : undefined
            if (pos !== undefined) {
              editor.chain().focus().setNodeSelection(pos).updateAttributes('image', { alignment: value }).run()
            }
            toolbar?.querySelectorAll('button').forEach(b => b.classList.remove(activeBtnClass))
            btn.classList.add(activeBtnClass)
          })
          toolbar.appendChild(btn)
        })

        toolbar.appendChild(document.createElement('span')).style.cssText = 'width:1px;height:16px;background:rgba(255,255,255,0.3);margin:0 2px;align-self:center'

        const radii = [0, 4, 8, 12, 16, 999]
        radii.forEach(r => {
          const btn = document.createElement('button')
          const currentR = node.attrs.borderRadius ? parseInt(node.attrs.borderRadius) : 0
          btn.title = r === 999 ? 'دائري' : r + 'px'
          btn.textContent = r === 999 ? '●' : r + ''
          btn.style.fontSize = r === 999 ? '13px' : '11px'
          btn.style.fontWeight = 'bold'
          if (currentR === r) btn.classList.add(activeBtnClass)
          btn.addEventListener('click', (e) => {
            e.stopPropagation()
            const val = r === 0 ? null : r
            img.style.borderRadius = val ? val + 'px' : ''
            const pos = typeof getPos === 'function' ? getPos() : undefined
            if (pos !== undefined) {
              editor.chain().focus().setNodeSelection(pos).updateAttributes('image', { borderRadius: val }).run()
            }
            toolbar?.querySelectorAll('button').forEach(b => b.classList.remove(activeBtnClass))
            btn.classList.add(activeBtnClass)
          })
          toolbar.appendChild(btn)
        })

        toolbar.appendChild(document.createElement('span')).style.cssText = 'width:1px;height:16px;background:rgba(255,255,255,0.3);margin:0 2px;align-self:center'

        const delBtn = document.createElement('button')
        delBtn.className = 'delete-btn'
        delBtn.title = 'حذف'
        delBtn.appendChild(makeSvg(14, 14, '0 0 24 24', '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'))
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          const pos = typeof getPos === 'function' ? getPos() : undefined
          if (pos !== undefined) {
            editor.chain().focus().setNodeSelection(pos).deleteSelection().run()
          }
        })
        toolbar.appendChild(delBtn)

        wrapper.appendChild(toolbar)
      }

      const hideToolbar = () => {
        if (toolbar) {
          toolbar.remove()
          toolbar = null
        }
      }

      wrapper.addEventListener('click', (e) => {
        e.stopPropagation()
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (pos !== undefined) {
          editor.chain().focus().setNodeSelection(pos).run()
        }
        wrapper.classList.add('selected')
        showToolbar()
      })

      const deselectHandler = () => {
        wrapper.classList.remove('selected')
        hideToolbar()
      }
      editor.on('selectionUpdate', deselectHandler)

      let startX, startY, startWidth, startHeight

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        isResizing = true
        startX = e.clientX
        startY = e.clientY
        startWidth = img.offsetWidth
        startHeight = img.offsetHeight || (startWidth * 0.75)
        wrapper.classList.add('selected')
        hideToolbar()

        const onMouseMove = (ev) => {
          if (!isResizing) return
          const newWidth = Math.max(50, startWidth + (ev.clientX - startX))
          const newHeight = Math.max(30, startHeight + (ev.clientY - startY))
          img.setAttribute('width', Math.round(newWidth))
          img.style.width = Math.round(newWidth) + 'px'
          img.style.height = Math.round(newHeight) + 'px'
        }

        const onMouseUp = () => {
          isResizing = false
          document.removeEventListener('mousemove', onMouseMove)
          document.removeEventListener('mouseup', onMouseUp)
          const finalWidth = img.offsetWidth
          const finalHeight = img.offsetHeight
          const pos = typeof getPos === 'function' ? getPos() : undefined
          if (pos !== undefined) {
            editor.chain().focus().setNodeSelection(pos).updateAttributes('image', {
              width: Math.round(finalWidth),
              height: Math.round(finalHeight),
            }).run()
          }
        }

        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
      })

      return {
        dom: wrapper,
        ignoreMutation: () => true,
        destroy: () => {
          editor.off('selectionUpdate', deselectHandler)
        }
      }
    }
  },
})

export default ResizableImage