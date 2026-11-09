/**
 * dsh-sgv-preview — Host 半。
 *
 * 在 Host 侧用 SuperGoodViewer 的无头 CLI（sgv-cli）把 Markdown 编译成 PDF，
 * 再以 application/pdf 返回给浏览器里的预览正文。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'

export const name = 'dsh-sgv-preview'
export const inject = ['webServer', 'sessions']

const ROUTE = '/api/dsh-sgv/preview'
const MAX_BODY = 64 * 1024
const MAX_PDF = 128 * 1024 * 1024
const CACHE_ENTRIES = 12

const DEFAULTS = {
  format: 'a4',
  theme: 'light',
  fontSize: 11,
  timeoutMs: 20000,
  cliPath: '',
}

const MARKDOWN_EXT = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx'])
function defaultCli() {
  const local = process.env.LOCALAPPDATA
  if (local) return join(local, 'SuperGoodViewer', 'sgv-cli.exe')
  return 'sgv-cli'
}

function readJson(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolvePromise(text.length === 0 ? {} : JSON.parse(text))
      } catch (error) {
        reject(new Error('invalid JSON body: ' + String(error && error.message ? error.message : error)))
      }
    })
    req.on('error', reject)
  })
}

function resolveInsideWorkspace(cwd, requested) {
  const root = normalize(resolve(cwd))
  const absolute = isAbsolute(requested) ? normalize(requested) : resolve(root, requested)
  const rel = relative(root, absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('path escapes the session workspace')
  return absolute
}
function runCli(cli, args, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cli, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise({ stdout, stderr })
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('sgv-cli timed out after ' + timeoutMs + 'ms'))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => finish(new Error('cannot start sgv-cli: ' + String(error && error.message ? error.message : error))))
    child.on('close', (code) => {
      if (code === 0) return finish()
      const detail = stderr.trim().slice(0, 400) || stdout.trim().slice(0, 400)
      finish(new Error('sgv-cli exited with ' + String(code) + ': ' + detail))
    })
  })
}
export function apply(ctx, config = {}) {
  const options = Object.assign({}, DEFAULTS, config)
  const cli = options.cliPath || defaultCli()
  const cache = new Map()

  const remember = (key, pdf) => {
    cache.set(key, pdf)
    while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value)
  }

  const handler = async (req, res) => {
    const fail = (status, message) => {
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: message }))
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return fail(405, 'method not allowed')
    }

    let body
    try {
      body = await readJson(req)
    } catch (error) {
      return fail(400, String(error && error.message ? error.message : error))
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const requested = typeof body.path === 'string' ? body.path : ''
    if (!sessionId || !requested) return fail(400, 'sessionId and path are required')

    const session = ctx.sessions.get(sessionId)
    if (!session) return fail(404, 'session not found')
    const cwd = (session.header && session.header.cwd) || process.cwd()

    let target
    try {
      target = resolveInsideWorkspace(cwd, requested)
    } catch (error) {
      return fail(403, String(error && error.message ? error.message : error))
    }

    if (!MARKDOWN_EXT.has(extname(target).toLowerCase())) {
      return fail(415, 'only Markdown files are rendered by SuperGoodViewer')
    }

    let info
    try {
      info = await stat(target)
    } catch {
      return fail(404, 'file not found')
    }
    if (!info.isFile()) return fail(400, 'not a regular file')
    const theme = body.theme === 'dark' ? 'dark' : 'light'
    const format = typeof body.format === 'string' && body.format ? body.format : options.format
    const fontSize = Number.isFinite(Number(body.fontSize)) ? Number(body.fontSize) : options.fontSize
    const version = String(info.mtimeMs) + ':' + String(info.size)
    const key = [target, version, theme, format, String(fontSize)].join('|')

    let pdf = cache.get(key)
    if (pdf === undefined) {
      let dir
      try {
        dir = await mkdtemp(join(tmpdir(), 'dsh-sgv-'))
        const out = join(dir, 'preview.pdf')
        await runCli(cli, ['export', target, '-o', out, '-f', format, '-t', theme, '-s', String(fontSize)], options.timeoutMs)
        pdf = await readFile(out)
        if (pdf.byteLength > MAX_PDF) throw new Error('exported PDF exceeds the size limit')
        remember(key, pdf)
      } catch (error) {
        return fail(502, String(error && error.message ? error.message : error))
      } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    }

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'no-store',
      'X-Sgv-Version': version,
    })
    res.end(pdf)
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler }))
}
