import { useCallback, useEffect, useState } from 'react'

// Track an element's content-box width (padding excluded) so layout can be sized
// from the space actually available rather than hard-coded pixels. Returns
// [ref, width]; width is 0 until the first measurement lands.
//
// The ref is a callback ref on purpose: the measured element often mounts after a
// loading state, so we must start observing when it appears, not only on mount.
export default function useElementWidth() {
  const [node, setNode] = useState(null)
  const [width, setWidth] = useState(0)

  const ref = useCallback(el => setNode(el), [])

  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])

  return [ref, width]
}
