export class RenderBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenderBusyError'
  }
}

export class RenderFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenderFailedError'
  }
}

export class RenderAbortedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenderAbortedError'
  }
}
