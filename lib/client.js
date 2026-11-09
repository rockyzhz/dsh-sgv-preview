/**
 * dsh-sgv-preview — Client 半（浏览器）。
 *
 * 向 documentPreviews 注册一个 .md 渲染器：把文件交给 Host 的 sgv-cli 导出 PDF，
 * 再用 blob iframe 在右栏内显示 SuperGoodViewer 的出版级排版。
 *
 * 该文件是 DSH 客户端 bundle 的 CJS closure 工厂，由 window.__ModuleLoader__ 装载。
 */
window.__ModuleLoader__.load({
  id: 'dsh-sgv-preview',
  factory: (require) => {
    const React = require('react')
    const { useEffect, useRef, useState } = React

    const BODY_ID = 'dsh-sgv-preview/markdown'
    const ENDPOINT = '/api/dsh-sgv/preview'
    const ADDRESS_PREFIX = 'dsh-resource://file/'

    const TEXT = {
      rendering: '超好读排版中…',
      failed: '超好读渲染失败',
      retry: '重试',
      title: '超好读预览',
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

    /** 读取当前 DSH 主题；跟随 data-theme / class 与系统偏好。 */
    function readTheme() {
      const root = document.documentElement
      const explicit = root.getAttribute('data-theme') || root.dataset.theme || root.className || ''
      if (/dark/i.test(String(explicit))) return 'dark'
      if (/light/i.test(String(explicit))) return 'light'
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    const STYLE_ROOT = {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      overflow: 'hidden',
    }
    const STYLE_FRAME = {
      flex: '1 1 auto',
      width: '100%',
      height: '100%',
      minHeight: 0,
      border: 0,
      display: 'block',
      background: 'transparent',
    }
    const STYLE_STATUS = {
      flex: '1 1 auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: 24,
      fontSize: 13,
      color: 'var(--dsw-alias-label-secondary, #888)',
    }

    function SgvBody(props) {
      const { tab } = props.useTabInfo()
      const resourceAddress = props.resourceAddress
      const request = props.content && props.content.kind === 'renderer' ? props.content : undefined
      const revision = request ? request.revision : 0
      const theme = readTheme()
      const [state, setState] = useState({ status: 'loading' })
      const urlRef = useRef(null)

      useEffect(() => {
        if (!request) return undefined
        const file = parseFileAddress(resourceAddress)
        if (!file) {
          setState({ status: 'error', message: '无法解析文件地址' })
          request.failed()
          return undefined
        }

        const controller = new AbortController()
        let disposed = false
        setState({ status: 'loading' })

        const run = async () => {
          try {
            const response = await fetch(ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: file.sessionId, path: file.path, theme }),
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
            const blob = await response.blob()
            if (disposed) return
            const url = URL.createObjectURL(blob)
            if (urlRef.current) URL.revokeObjectURL(urlRef.current)
            urlRef.current = url
            setState({ status: 'ready', url })
            request.loaded(response.headers.get('X-Sgv-Version') || undefined)
          } catch (error) {
            if (disposed || (error && error.name === 'AbortError')) return
            setState({ status: 'error', message: String(error && error.message ? error.message : error) })
            request.failed()
          }
        }

        run()
        return () => {
          disposed = true
          controller.abort()
        }
      }, [revision, resourceAddress, theme])

      useEffect(() => () => {
        if (urlRef.current) {
          URL.revokeObjectURL(urlRef.current)
          urlRef.current = null
        }
      }, [])

      if (!request) return null

      if (state.status === 'error') {
        return React.createElement(
          'div',
          { style: STYLE_ROOT },
          React.createElement(
            'div',
            { style: STYLE_STATUS, role: 'alert' },
            React.createElement('span', null, TEXT.failed + '：' + state.message),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => request.reload(),
                style: { cursor: 'pointer', padding: '2px 10px' },
              },
              TEXT.retry,
            ),
          ),
        )
      }

      if (state.status !== 'ready') {
        return React.createElement(
          'div',
          { style: STYLE_ROOT },
          React.createElement('div', { style: STYLE_STATUS }, TEXT.rendering),
        )
      }

      return React.createElement(
        'div',
        { style: STYLE_ROOT },
        React.createElement('iframe', {
          src: state.url,
          style: STYLE_FRAME,
          title: (tab && tab.title) || TEXT.title,
        }),
      )
    }
    const inject = ['slots', 'documentPreviews']

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

    return { name: 'dsh-sgv-preview', inject, apply }
  },
})
