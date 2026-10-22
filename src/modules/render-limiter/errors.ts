export class RenderBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenderBusyError'
  }
}

export class RenderQueueFullError extends RenderBusyError {
  constructor() {
    super('Too many map renders queued')
    this.name = 'RenderQueueFullError'
  }
}

export class RenderQueueTimeoutError extends RenderBusyError {
  constructor(waitMs: number) {
    super(`Timed out after ${waitMs}ms waiting for a map render slot`)
    this.name = 'RenderQueueTimeoutError'
  }
}
