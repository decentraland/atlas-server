/**
 * A render worker whose thread dies on a 13 px wide job, like one killed out of memory
 * mid-render; any other job goes to the real worker transpiled by the jest globalSetup.
 */
const { COMPILED_RENDER_WORKER } = require('../harness/compile-render-worker')
const render = require(COMPILED_RENDER_WORKER).default

module.exports = function crashingRender(job) {
  if (job.width === 13) {
    process.exit(1)
  }
  return render(job)
}
