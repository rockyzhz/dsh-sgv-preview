/**
 * dsh-sgv-preview — Client 半（浏览器）。
 *
 * 右栏内嵌 SuperGoodViewer 排版：Host 用 sgv-cli 导出 PDF，这里用 PDF.js 自绘，
 * 顶部工具栏仿浏览器内置查看器，向上滚动才浮现，空闲后自动隐藏。
 */
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { getDocument } from 'pdfjs-dist/build/pdf.min.mjs'
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.min.mjs'

// PDF.js 主线程 fake worker：避免额外 worker 文件与插件 assets 路由。
globalThis.pdfjsWorker = { WorkerMessageHandler }

const BODY_ID = 'dsh-sgv-preview/markdown'
const ENDPOINT = '/api/dsh-sgv/preview'
const ADDRESS_PREFIX = 'dsh-resource://file/'
const HUD_IDLE_MS = 2600
const PAGE_GAP = 12
const SIDEBAR_WIDTH = 132
const THUMB_WIDTH = 104

const TEXT = {
  rendering: '超好读排版中…',
  failed: '超好读渲染失败',
  retry: '重试',
  title: '超好读预览',
  fitWidthLabel: '适应宽度',
  fitHeightLabel: '适应高度',
  zoomIn: '放大',
  zoomOut: '缩小',
  toScroll: '切换到长卷轴',
  toPaged: '切换到 A4 分页',
  download: '下载 PDF',
  print: '打印',
  more: '更多',
  openInApp: '在超好读中打开',
  toggleSidebar: '切换缩略图',
  pageOf: '页',
}

const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  zoomOut: 'M5 12h14',
  zoomIn: 'M5 12h14M12 5v14',
  fitWidth: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
  fitHeight: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  scroll: 'M4 5h16M4 9h16M4 13h16M4 17h16M4 21h9',
  paged: 'M6 3h8l4 4v14H6zM14 3v4h4',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 21h16',
  print: 'M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z',
  more: 'M12 6h.01M12 12h.01M12 18h.01',
  open: 'M14 4h6v6M20 4l-9 9M19 13v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6',
}

function Icon({ path, size }) {
  return createElement('svg', {
    width: size || 18,
    height: size || 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }, createElement('path', { d: path }))
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

function fileNameOf(address) {
  const file = parseFileAddress(address)
  if (!file) return 'document.pdf'
  const name = file.path.split('/').pop() || 'document'
  return name.replace(/\.[^.]+$/, '') + '.pdf'
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

const TOOLBAR_BG = '#3c3c3c'
const TOOLBAR_FG = '#f1f1f1'

/** 单页画布：进入视口附近才渲染，缩放/旋转变化时重绘。 */
function PdfPage({ pdf, pageNumber, scale, rotation, theme }) {
  const hostRef = useRef(null)
  const canvasRef = useRef(null)
  const [size, setSize] = useState(null)
  const [visible, setVisible] = useState(pageNumber <= 2)

  useEffect(() => {
    let alive = true
    pdf.getPage(pageNumber).then((page) => {
      if (!alive) return
      const viewport = page.getViewport({ scale: 1, rotation })
      setSize({ width: viewport.width, height: viewport.height })
    }).catch(() => {})
    return () => { alive = false }
  }, [pdf, pageNumber, rotation])

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
      const viewport = page.getViewport({ scale, rotation })
      // 长卷轴是单页超长 PDF，限制画布像素避免超过浏览器上限。
      const dpr = Math.min(window.devicePixelRatio || 1, Math.max(1, 16384 / Math.max(viewport.width, viewport.height)))
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
      task.promise.catch(() => {})
    }).catch(() => {})
    return () => {
      cancelled = true
      if (task) { try { task.cancel() } catch (ignored) { /* 已结束 */ } }
    }
  }, [visible, size, scale, pdf, pageNumber, rotation])

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

/** 侧栏缩略图：按固定宽度渲染，点击跳到对应页。 */
function PdfThumb({ pdf, pageNumber, active, theme, onSelect }) {
  const hostRef = useRef(null)
  const canvasRef = useRef(null)
  const [size, setSize] = useState(null)
  const [visible, setVisible] = useState(pageNumber <= 6)

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
    }, { rootMargin: '200px 0px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || !size) return undefined
    const canvas = canvasRef.current
    if (!canvas) return undefined
    let cancelled = false
    let task = null
    const scale = THUMB_WIDTH / size.width
    pdf.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const dpr = window.devicePixelRatio || 1
      const viewport = page.getViewport({ scale })
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr))
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr))
      canvas.style.width = viewport.width + 'px'
      canvas.style.height = viewport.height + 'px'
      task = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      })
      task.promise.catch(() => {})
    }).catch(() => {})
    return () => {
      cancelled = true
      if (task) { try { task.cancel() } catch (ignored) { /* 已结束 */ } }
    }
  }, [visible, size, pdf, pageNumber])

  return createElement('button', {
    ref: hostRef,
    type: 'button',
    onClick: () => onSelect(pageNumber),
    style: {
      display: 'block',
      width: '100%',
      padding: 0,
      margin: '0 0 8px',
      border: '2px solid ' + (active ? '#4c8bf5' : 'transparent'),
      borderRadius: 4,
      background: 'transparent',
      cursor: 'pointer',
      overflow: 'hidden',
      lineHeight: 0,
    },
    title: '第 ' + pageNumber + ' 页',
  }, createElement('canvas', {
    ref: canvasRef,
    style: { display: 'block', width: '100%', background: theme.page },
  }))
}

/** 右栏正文：PDF.js 自绘，完整工具栏默认隐藏、向上滚动浮现。 */
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
  const pdfUrlRef = useRef(null)
  const currentPageRef = useRef(1)

  const [status, setStatus] = useState('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [pdf, setPdf] = useState(null)
  const [pageCount, setPageCount] = useState(0)
  const [baseScale, setBaseScale] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [layout, setLayout] = useState('a4')
  const [fitMode, setFitMode] = useState('width')
  const [hudVisible, setHudVisible] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
          body: JSON.stringify({ sessionId: file.sessionId, path: file.path, theme: themeName, format: layout }),
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
        if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current)
        pdfUrlRef.current = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }))
        loadingTaskRef.current = loadingTask
        pdfRef.current = doc
        setPdf(doc)
        setPageCount(doc.numPages)
        setZoom(1)
        setStatus('ready')
        setPageInput('1')
        currentPageRef.current = 1
        setCurrentPage(1)
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
  }, [revision, resourceAddress, themeName, layout])

  useEffect(() => () => {
    if (loadingTaskRef.current) {
      try { loadingTaskRef.current.destroy() } catch (ignored) { /* 卸载 */ }
      loadingTaskRef.current = null
    }
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current)
      pdfUrlRef.current = null
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
        const viewport = page.getViewport({ scale: 1, rotation })
        const availableWidth = Math.max(160, el.clientWidth - PAGE_GAP * 2)
        const availableHeight = Math.max(160, el.clientHeight - PAGE_GAP * 2)
        const widthScale = availableWidth / viewport.width
        const heightScale = availableHeight / viewport.height
        setBaseScale(fitMode === 'height' ? heightScale : widthScale)
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
  }, [pdf, rotation, fitMode, sidebarOpen])

  const scrollToPage = useCallback((pageNumber) => {
    const el = scrollRef.current
    if (!el) return
    const node = el.querySelector('[data-page="' + pageNumber + '"]')
    if (node) el.scrollTop = node.offsetTop - PAGE_GAP
  }, [])

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

  const downloadPdf = useCallback(() => {
    if (!pdfUrlRef.current) return
    const anchor = document.createElement('a')
    anchor.href = pdfUrlRef.current
    anchor.download = fileNameOf(resourceAddress)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }, [resourceAddress])

  const printPdf = useCallback(() => {
    if (!pdfUrlRef.current) return
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    frame.src = pdfUrlRef.current
    frame.onload = () => {
      try {
        frame.contentWindow.focus()
        frame.contentWindow.print()
      } catch (ignored) {
        /* 打印被拦截时静默 */
      }
      setTimeout(() => frame.remove(), 60000)
    }
    document.body.appendChild(frame)
  }, [])

  const showHud = useCallback(() => {
    setHudVisible(true)
    if (hudTimer.current) clearTimeout(hudTimer.current)
    hudTimer.current = setTimeout(() => setHudVisible(false), HUD_IDLE_MS)
  }, [])

  const keepHud = useCallback(() => {
    if (hudTimer.current) clearTimeout(hudTimer.current)
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
      setPageInput(String(current))
    }
  }, [showHud, hideHud])

  const zoomBy = (step) => {
    setZoom((value) => Math.min(3, Math.max(0.4, Math.round((value + step) * 10) / 10)))
  }

  const commitPage = () => {
    const wanted = parseInt(pageInput, 10)
    if (!Number.isFinite(wanted)) {
      setPageInput(String(currentPage))
      return
    }
    const next = Math.min(pageCount, Math.max(1, wanted))
    setPageInput(String(next))
    currentPageRef.current = next
    setCurrentPage(next)
    scrollToPage(next)
  }

  const outerStyle = {
    position: 'relative',
    width: '100%',
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
    background: colors.bg,
  }
  const sidebarStyle = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: SIDEBAR_WIDTH,
    padding: 10,
    boxSizing: 'border-box',
    overflowY: 'auto',
    background: themeName === 'dark' ? '#202124' : '#e6e7e9',
    borderRight: themeName === 'dark' ? '1px solid #2e3033' : '1px solid #d5d7da',
    transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
    transition: 'transform .2s ease',
    zIndex: 6,
  }
  const scrollStyle = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: sidebarOpen ? SIDEBAR_WIDTH : 0,
    right: 0,
    overflowY: 'auto',
    overflowX: 'auto',
    padding: PAGE_GAP + 'px',
    boxSizing: 'border-box',
    transition: 'left .2s ease',
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
  const toolButton = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    border: 0,
    borderRadius: 6,
    background: 'transparent',
    color: TOOLBAR_FG,
    cursor: 'pointer',
    padding: 0,
    flex: 'none',
  }
  const separator = {
    width: 1,
    height: 22,
    background: 'rgba(255,255,255,.24)',
    margin: '0 4px',
    flex: 'none',
  }
  const toolbarStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 48,
    transform: hudVisible ? 'translateY(0)' : 'translateY(-100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    padding: '0 12px',
    boxSizing: 'border-box',
    borderRadius: 0,
    background: TOOLBAR_BG,
    color: TOOLBAR_FG,
    boxShadow: hudVisible ? '0 1px 8px rgba(0,0,0,.35)' : 'none',
    opacity: hudVisible ? 1 : 0,
    pointerEvents: hudVisible ? 'auto' : 'none',
    transition: 'opacity .18s ease, transform .18s ease',
    zIndex: 20,
    whiteSpace: 'nowrap',
    font: '12px/1.2 system-ui, -apple-system, Segoe UI, sans-serif',
  }
  const pageField = {
    width: 32,
    height: 28,
    border: 0,
    borderRadius: 4,
    background: '#2b2b2b',
    color: '#fff',
    textAlign: 'center',
    font: '14px/1 system-ui, sans-serif',
    outline: 'none',
    padding: 0,
  }
  const pageTotal = {
    margin: '0 8px 0 5px',
    opacity: 0.8,
    fontSize: 14,
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

  const thumbs = []
  if (pdf && sidebarOpen) {
    for (let index = 1; index <= pageCount; index += 1) {
      thumbs.push(createElement(PdfThumb, {
        key: index,
        pdf,
        pageNumber: index,
        active: currentPage === index,
        theme: colors,
        onSelect: (n) => scrollToPage(n),
      }))
    }
  }

  const tool = (key, path, title, onClick) => createElement('button', {
    key,
    type: 'button',
    style: toolButton,
    title,
    'aria-label': title,
    onClick,
  }, createElement(Icon, { path, size: 22 }))

  const toolbar = createElement('div', {
    style: toolbarStyle,
    onMouseEnter: keepHud,
    onMouseLeave: showHud,
  }, [
    tool('menu', ICONS.menu, TEXT.toggleSidebar, () => setSidebarOpen((value) => !value)),
    createElement('div', { key: 'pager', style: { display: 'flex', alignItems: 'center', gap: 4 } },
      createElement('input', {
        style: pageField,
        value: pageInput,
        inputMode: 'numeric',
        'aria-label': '页码',
        onChange: (event) => setPageInput(event.target.value.replace(/[^\d]/g, '')),
        onKeyDown: (event) => { if (event.key === 'Enter') commitPage() },
        onBlur: () => commitPage(),
      }),
      createElement('span', { style: pageTotal }, '/ ' + pageCount),
    ),
    tool('out', ICONS.zoomOut, TEXT.zoomOut, () => zoomBy(-0.1)),
    tool('in', ICONS.zoomIn, TEXT.zoomIn, () => zoomBy(0.1)),
    tool('fitWidth', ICONS.fitWidth, TEXT.fitWidthLabel, () => { setFitMode('width'); setZoom(1) }),
    tool('fitHeight', ICONS.fitHeight, TEXT.fitHeightLabel, () => { setFitMode('height'); setZoom(1) }),
    tool('layout', layout === 'fluid' ? ICONS.paged : ICONS.scroll, layout === 'fluid' ? TEXT.toPaged : TEXT.toScroll, () => setLayout((value) => (value === 'fluid' ? 'a4' : 'fluid'))),
    tool('download', ICONS.download, TEXT.download, downloadPdf),
    tool('print', ICONS.print, TEXT.print, printPdf),
    tool('open', ICONS.open, TEXT.openInApp, openInSgv),
  ])

  return createElement('div', {
    style: outerStyle,
    onMouseMove: (event) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientY - rect.top <= 64) showHud()
    },
  },
    createElement('div', { style: sidebarStyle }, thumbs),
    body,
    toolbar,
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
