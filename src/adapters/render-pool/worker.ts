import { move, transferableSymbol, valueSymbol } from 'piscina'
import { renderJob } from './render'
import { RenderJob } from './types'

// piscina's entry point: renders the job and transfers the PNG back instead of copying it
export default function render(job: RenderJob) {
  const result = renderJob(job)
  return move({
    get [transferableSymbol]() {
      return result.png.buffer
    },
    get [valueSymbol]() {
      return result
    },
  })
}
