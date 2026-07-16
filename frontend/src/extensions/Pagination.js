import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DecorationSet } from '@tiptap/pm/view'

// Holds the live pagination spacers (widget decorations) that push content down at each page
// boundary, so the editor shows real A4 pages: a page's content ends at its bottom-margin line,
// then an empty band (bottom margin + next top margin), then the next page starts below its
// header. ReportEditor computes the spacers (block-aware, matching the export) and pushes them in
// via a `setMeta(paginationKey, decorationSet)` transaction; passing DecorationSet.empty clears
// them (used during PDF capture, which paginates the gapless content itself).
export const paginationKey = new PluginKey('pagination')

const Pagination = Extension.create({
  name: 'pagination',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(paginationKey)
            if (meta) return meta
            return old.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return paginationKey.getState(state)
          },
        },
      }),
    ]
  },
})

export default Pagination
