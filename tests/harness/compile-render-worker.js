/**
 * globalSetup of jest (see jest.config.js): transpiles src/ once, so the render pool's
 * worker threads run plain JS instead of each loading ts-node and the TypeScript compiler.
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '../..')
// under node_modules so the transpiled files still resolve the dependencies
const OUT_DIR = path.join(ROOT, 'node_modules/.cache/atlas-render-worker')

const COMPILED_RENDER_WORKER = path.join(
  OUT_DIR,
  'adapters/render-pool/worker.js'
)

function listSources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return listSources(file)
    }
    return /\.(ts|json)$/.test(entry.name) ? [file] : []
  })
}

module.exports = async function compileRenderWorker() {
  const { config } = ts.readConfigFile(
    path.join(ROOT, 'tsconfig.json'),
    ts.sys.readFile
  )
  const { options } = ts.convertCompilerOptionsFromJson(
    config.compilerOptions,
    ROOT
  )
  const srcDir = path.join(ROOT, 'src')
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  for (const file of listSources(srcDir)) {
    const relative = path.relative(srcDir, file)
    fs.mkdirSync(path.join(OUT_DIR, path.dirname(relative)), {
      recursive: true,
    })
    if (file.endsWith('.json')) {
      fs.copyFileSync(file, path.join(OUT_DIR, relative))
      continue
    }
    const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: options,
      fileName: file,
    })
    fs.writeFileSync(
      path.join(OUT_DIR, relative.replace(/\.ts$/, '.js')),
      outputText
    )
  }
}
module.exports.COMPILED_RENDER_WORKER = COMPILED_RENDER_WORKER
