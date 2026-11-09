/**
 * dsh-sgv-preview — Client 半（浏览器）。
 *
 * 右栏内嵌 SuperGoodViewer 排版：Host 用 sgv-cli 导出 PDF，这里用 PDF.js 自绘，
 * 以便完全控制阅读界面——无侧栏、无内置工具栏，向上滚动才浮现 HUD。
 */
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { getDocument } from 'pdfjs-dist/build/pdf.min.mjs'
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.min.mjs'

// PDF.js 主线程 fake worker：避免额外 worker 文件与插件 assets 路由。
globalThis.pdfjsWorker = { WorkerMessageHandler }

const BODY_ID = 'dsh-sgv-preview/markdown'
const ENDPOINT = '/api/dsh-sgv/preview'
const ADDRESS_PREFIX = 'dsh-resource://file/'
const HUD_IDLE_MS = 2400
const PAGE_GAP = 12

const TEXT = {
  rendering: '超好读排版中…',
  failed: '超好读渲染失败',
  retry: '重试',
  title: '超好读预览',
  fitWidth: '适应宽度',
  zoomIn: '放大',
  zoomOut: '缩小',
  pageOf: '页',
}

/** 复刻 Host 的 file 地址语法：dsh-resource://file/session/<id>/<path>。 */
function parseFileAddress(address) {
  try {
    if (typeof address !== 'string' || !address.startsWith(ADDRESS_PREFIX)) return undefined
    const end = address.search(/[?#]/)
    const rest = address.slice(ADDRESS_PREFIX.length, end === -1 ? undefined : end).split('/')
    if (rest[0] !== 'session') return undefined
    const id = rest[1]
    const segments = rest.slice(2)
    if (id === undefined || id === '' || segments.length === 0) return undefined
    return { sessionId: decodeURIComponent(id), path: segments.map(decodeURIComponent).join('/') }
  } catch {
    return undefined
  }
}

function readTheme() {
  const root = document.documentElement
  const explicit = root.getAttribute('data-theme') || root.dataset.theme || root.className || ''
  if (/dark/i.test(String(explicit))) return 'dark'
  if (/light/i.test(String(explicit))) return 'light'
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const COLORS = {
  light: { bg: '#f2f3f5', page: '#ffffff', shadow: '0 1px 4px rgba(0,0,0,.14)' },
  dark: { bg: '#17181a', page: '#ffffff', shadow: '0 1px 6px rgba(0,0,0,.5)' },
}

/** 单页画布：进入视口附近才渲染，缩放变化时重绘。 */
function PdfPage({ pdf, pageNumber, scale, theme }) {
  const hostRef = useRef(null)
  const canvasRef = useRef(null)
  const taskRef = useRef(null)
  const [size, setSize] = useState(null)
  const [visible, setVisible] = useState(pageNumber <= 2)

  useEffect(() => {
    let alive = true
    pdf.getPage(pageNumber).then((page) => {
      if (!alive) return
      const viewport = page.getViewport({ scale: 1 })
      setSize({ width: viewport.width, height: viewport.height })
    }).catch(() => {})
    return () => { alive = false }
  }, [pdf, pageNumber])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) setVisible(true)
    }, { rootMargin: '800px 0px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !size) return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined
    let cancelled = false
    let task = null
    pdf.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const dpr = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale })
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr))
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr))
      canvas.style.width = viewport.width + 'px'
      canvas.style.height = viewport.height + 'px'
      const context = canvas.getContext('2d')
      task = page.render({
        canvasContext: context,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      })
      taskRef.current = task
      task.promise.catch(() => {})
    }).catch(() => {})
    return () => {
      cancelled = true
      if (task) { try { task.cancel() } catch (ignored) { /* 已结束 */ } }
    }
  }, [visible, size, scale, pdf, pageNumber])

  return createElement('div', {
    ref: hostRef,
    'data-page': pageNumber,
    style: {
      position: 'relative',
      width: size ? size.width * scale : '100%',
      height: size ? size.height * scale : 240,
      margin: '0 auto ' + PAGE_GAP + 'px',
      background: theme.page,
      boxShadow: theme.shadow,
      borderRadius: 2,
      overflow: 'hidden',
    },
  }, size ? createElement('canvas', {
    ref: canvasRef,
    style: { display: 'block', width: '100%', height: '100%' },
  }) : null)
}

/** 右栏正文：PDF.js 自绘，无侧栏与常驻工具栏。 */
function SgvBody(props) {
  const { tab } = props.useTabInfo()
  const resourceAddress = props.resourceAddress
  const request = props.content && props.content.kind === 'renderer' ? props.content : undefined
  const revision = request ? request.revision : 0
  const themeName = readTheme()
  const colors = COLORS[themeName] || COLORS.light

  const scrollRef = useRef(null)
  const hudTimer = useRef(null)
  const lastScroll = useRef(0)
  const pdfRef = useRef(null)
  const loadingTaskRef = useRef(null)
  const currentPageRef = useRef(1)

  const [status, setStatus] = useState('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [pdf, setPdf] = useState(null)
  const [pageCount, setPageCount] = useState(0)
  const [baseScale, setBaseScale] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [hudVisible, setHudVisible] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    if (!request) return undefined
    const file = parseFileAddress(resourceAddress)
    if (!file) {
      setStatus('error')
      setErrorMsg('无法解析文件地址')
      request.failed()
      return undefined
    }
    let cancelled = false
    const controller = new AbortController()
    setStatus('loading')
    setErrorMsg('')
    const run = async () => {
      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: file.sessionId, path: file.path, theme: themeName }),
          signal: controller.signal,
          credentials: 'same-origin',
        })
        if (!response.ok) {
          let detail = ''
          try {
            const payload = await response.json()
            detail = payload && payload.error ? String(payload.error) : ''
          } catch (ignored) {
            detail = ''
          }
          throw new Error(detail || 'HTTP ' + response.status)
        }
        const buffer = await response.arrayBuffer()
        if (cancelled) return
        const loadingTask = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false })
        const doc = await loadingTask.promise
        if (cancelled) {
          try { loadingTask.destroy() } catch (ignored) { /* 已取消 */ }
          return
        }
        if (loadingTaskRef.current) {
          try { loadingTaskRef.current.destroy() } catch (ignored) { /* 旧文档 */ }
        }
        loadingTaskRef.current = loadingTask
        pdfRef.current = doc
        setPdf(doc)
        setPageCount(doc.numPages)
        setZoom(1)
        setStatus('ready')
        lastScroll.current = 0
        request.loaded(response.headers.get('X-Sgv-Version') || undefined)
      } catch (error) {
        if (cancelled || (error && error.name === 'AbortError')) return
        setStatus('error')
        setErrorMsg(String(error && error.message ? error.message : error))
        request.failed()
      }
    }
    run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [revision, resourceAddress, themeName])

  useEffect(() => () => {
    if (loadingTaskRef.current) {
      try { loadingTaskRef.current.destroy() } catch (ignored) { /* 卸载 */ }
      loadingTaskRef.current = null
    }
    pdfRef.current = null
    if (hudTimer.current) clearTimeout(hudTimer.current)
  }, [])

  useEffect(() => {
    if (!pdf) return undefined
    let alive = true
    let timer = 0
    const compute = () => {
      const el = scrollRef.current
      if (!el) return
      pdf.getPage(1).then((page) => {
        if (!alive) return
        const viewport = page.getViewport({ scale: 1 })
        const available = Math.max(160, el.clientWidth - PAGE_GAP * 2)
        setBaseScale(available / viewport.width)
      }).catch(() => {})
    }
    compute()
    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(compute, 120)
    })
    if (scrollRef.current) observer.observe(scrollRef.current)
    return () => {
      alive = false
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [pdf])

  const openInSgv = useCallback(async () => {
    const file = parseFileAddress(resourceAddress)
    if (!file) return
    try {
      await fetch('/api/dsh-sgv/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: file.sessionId, path: file.path }),
        credentials: 'same-origin',
      })
    } catch (ignored) {
      /* 打开失败时保持当前预览 */
    }
  }, [resourceAddress])

  const showHud = useCallback(() => {
    setHudVisible(true)
    if (hudTimer.current) clearTimeout(hudTimer.current)
    hudTimer.current = setTimeout(() => setHudVisible(false), HUD_IDLE_MS)
  }, [])

  const hideHud = useCallback(() => {
    if (hudTimer.current) clearTimeout(hudTimer.current)
    setHudVisible(false)
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const top = el.scrollTop
    const delta = top - lastScroll.current
    lastScroll.current = top
    if (delta < -2) showHud()
    else if (delta > 2) hideHud()

    const pages = el.querySelectorAll('[data-page]')
    let current = 1
    for (const node of pages) {
      if (node.offsetTop <= top + el.clientHeight * 0.34) current = Number(node.dataset.page)
    }
    if (current !== currentPageRef.current) {
      currentPageRef.current = current
      setCurrentPage(current)
    }
  }, [showHud, hideHud])

  const zoomBy = (step) => {
    setZoom((value) => Math.min(3, Math.max(0.4, Math.round((value + step) * 10) / 10)))
  }

  const outerStyle = {
    position: 'relative',
    width: '100%',
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
    background: colors.bg,
  }
  const scrollStyle = {
    position: 'absolute',
    inset: 0,
    overflowY: 'auto',
    overflowX: 'auto',
    padding: PAGE_GAP + 'px',
    boxSizing: 'border-box',
    scrollBehavior: 'auto',
  }
  const statusStyle = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: 10,
    fontSize: 13,
    color: themeName === 'dark' ? '#9aa0a6' : '#6b7075',
  }
  const buttonStyle = {
    border: 0,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    padding: '3px 7px',
    borderRadius: 6,
    lineHeight: 1,
  }
  const metaStyle = {
    minWidth: 58,
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
  }

  let body
  if (status === 'error') {
    body = createElement('div', { style: statusStyle }, [
      createElement('div', { key: 'msg', style: { maxWidth: 320, textAlign: 'center', lineHeight: 1.6 } }, TEXT.failed + '：' + errorMsg),
      createElement('button', {
        key: 'retry',
        type: 'button',
        onClick: () => request && request.reload(),
        style: { cursor: 'pointer', padding: '4px 14px', borderRadius: 6, border: '1px solid currentColor', background: 'transparent', color: 'inherit' },
      }, TEXT.retry),
    ])
  } else if (status !== 'ready' || !pdf) {
    body = createElement('div', { style: statusStyle }, TEXT.rendering)
  } else {
    const pages = []
    for (let index = 1; index <= pageCount; index += 1) {
      pages.push(createElement(PdfPage, {
        key: index,
        pdf,
        pageNumber: index,
        scale: baseScale * zoom,
        theme: colors,
      }))
    }
    body = createElement('div', { ref: scrollRef, style: scrollStyle, onScroll }, pages)
  }

  const hudTransform = hudVisible ? 'translate(-50%, 0)' : 'translate(-50%, -160%)'
  const hudStyle = {
    position: 'absolute',
    top: 8,
    left: '50%',
    transform: hudTransform,
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '4px 8px',
    borderRadius: 10,
    background: themeName === 'dark' ? 'rgba(42,44,48,.94)' : 'rgba(255,255,255,.95)',
    boxShadow: '0 2px 14px rgba(0,0,0,.22)',
    color: themeName === 'dark' ? '#e6e7e9' : '#333',
    font: '12px/1.4 system-ui, -apple-system, Segoe UI, sans-serif',
    opacity: hudVisible ? 1 : 0,
    pointerEvents: hudVisible ? 'auto' : 'none',
    transition: 'opacity .18s ease, transform .18s ease',
    zIndex: 10,
    whiteSpace: 'nowrap',
  }

  return createElement('div', {
    style: outerStyle,
    onMouseMove: (event) => { if (event.clientY <= 64) showHud() },
  },
    body,
    createElement('div', {
      style: hudStyle,
      onMouseEnter: () => { if (hudTimer.current) clearTimeout(hudTimer.current) },
      onMouseLeave: () => { showHud() },
    }, [
      createElement('button', { key: 'out', type: 'button', style: buttonStyle, title: TEXT.zoomOut, onClick: () => zoomBy(-0.1) }, '−'),
      createElement('span', { key: 'pct', style: metaStyle }, Math.round(zoom * 100) + '%'),
      createElement('button', { key: 'in', type: 'button', style: buttonStyle, title: TEXT.zoomIn, onClick: () => zoomBy(0.1) }, '+'),
      createElement('span', { key: 'sep', style: { width: 1, height: 14, background: 'currentColor', opacity: 0.18, margin: '0 4px' } }),
      createElement('button', { key: 'fit', type: 'button', style: buttonStyle, title: TEXT.fitWidth, onClick: () => setZoom(1) }, TEXT.fitWidth),
      createElement('span', { key: 'sep2', style: { width: 1, height: 14, background: 'currentColor', opacity: 0.18, margin: '0 4px' } }),
      createElement('span', { key: 'page', style: metaStyle }, currentPage + ' / ' + pageCount + ' ' + TEXT.pageOf),
      createElement('span', { key: 'sep3', style: { width: 1, height: 14, background: 'currentColor', opacity: 0.18, margin: '0 4px' } }),
      createElement('button', {
        key: 'open',
        type: 'button',
        style: { ...buttonStyle, padding: '3px 9px', borderRadius: 6, background: themeName === 'dark' ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.06)' },
        title: '用 SuperGoodViewer 完整应用打开',
        onClick: openInSgv,
      }, '在超好读中打开'),
    ]),
  )
}

const pluginName = 'dsh-sgv-preview'
const pluginInject = ['slots', 'documentPreviews']

function apply(ctx) {
  ctx.effect(
    () => ctx.documentPreviews.register({
      id: BODY_ID,
      extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx'],
      priority: 'extension',
      title: () => '超好读',
      loading: 'renderer',
      wrap: false,
    }),
    'dsh-sgv-preview: metadata',
  )

  ctx.effect(
    () => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
      name: 'sidebar.right.tab.document',
      key: BODY_ID,
    }, SgvBody)),
    'dsh-sgv-preview: body',
  )
}

export { pluginName as name, pluginInject as inject, apply }
