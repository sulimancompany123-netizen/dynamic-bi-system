// Shared report-background helpers, used by both the ReportEditor (global PDF background)
// and the PageBreak node (per-section background). Kept here so the templates and the
// tmpl:/url resolution logic have a single source of truth.
import bgFrame from '../assets/report-backgrounds/frame.svg'
import bgLetterhead from '../assets/report-backgrounds/letterhead.svg'
import bgWatermark from '../assets/report-backgrounds/watermark.svg'
import bgWavePink from '../assets/report-backgrounds/wave-pink.svg'
import bgDots from '../assets/report-backgrounds/dots.svg'
import bgGeometric from '../assets/report-backgrounds/geometric.svg'
// The above imports are handled by Vite's asset plugin, which copies the files to the build
// Built-in PDF background templates (the PDF libraries ship none, so we bundle these).
export const BG_TEMPLATES = [
  { id: 'wave-pink', name: 'موجات وردية', url: bgWavePink },
  { id: 'frame', name: 'إطار', url: bgFrame },
  { id: 'letterhead', name: 'ترويسة', url: bgLetterhead },
  { id: 'watermark', name: 'علامة مائية', url: bgWatermark },
  { id: 'dots', name: 'نقاط', url: bgDots },
  { id: 'geometric', name: 'هندسي', url: bgGeometric },
]

// Templates are stored in the report config as a stable `tmpl:<id>` reference (their
// bundled asset URL is hashed per build, so it can't be persisted). Uploaded images are
// stored as their plain URL. This resolves either form to a usable image source.
export const TEMPLATE_PREFIX = 'tmpl:'

export const resolveBgSrc = (value) => {
  if (!value) return null
  if (value.startsWith(TEMPLATE_PREFIX)) {
    return BG_TEMPLATES.find(t => t.id === value.slice(TEMPLATE_PREFIX.length))?.url || null
  }
  return value
}

// Load a data URL / src into an <Image> (used to composite backgrounds onto page canvases).
export const loadImage = (src) => new Promise((resolve, reject) => {
  const im = new window.Image()
  im.onload = () => resolve(im)
  im.onerror = reject
  im.src = src
})

// Convert a #rrggbb (or #rgb) hex + 0..1 opacity to an rgba() string. Falls back to the
// raw value for non-hex input so it degrades gracefully.
export const hexToRgba = (hex, opacity = 1) => {
  if (!hex || typeof hex !== 'string') return hex
  let h = hex.trim()
  if (h[0] !== '#') return h
  h = h.slice(1)
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const o = Math.max(0, Math.min(1, opacity))
  return `rgba(${r}, ${g}, ${b}, ${o})`
}
