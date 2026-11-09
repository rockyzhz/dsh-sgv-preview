import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
const data = new Uint8Array(readFileSync(process.env.TEMP + '/sgv-check.pdf'))
const task = getDocument({ data, useSystemFonts: true })
const doc = await task.promise
console.log('numPages:', doc.numPages)
const page = await doc.getPage(1)
const viewport = page.getViewport({ scale: 1 })
console.log('page1:', Math.round(viewport.width) + 'x' + Math.round(viewport.height))
const text = await page.getTextContent()
console.log('text items:', text.items.length)
console.log('sample:', text.items.slice(0, 6).map((i) => i.str).join(' | '))
await doc.destroy()
