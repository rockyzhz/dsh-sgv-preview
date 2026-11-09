import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

await build({
  entryPoints: [join(root, 'src/client.js')],
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120'],
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  banner: {
    js: "window.__ModuleLoader__.load({ id: 'dsh-sgv-preview', factory: (require) => {\n\"use strict\";\nvar module = { exports: {} };\nvar exports = module.exports;",
  },
  footer: {
    js: "\nreturn module.exports;\n} });",
  },
  legalComments: 'none',
  sourcemap: false,
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
})

console.log('built lib/client.js')
