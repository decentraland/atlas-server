export class RenderBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenderBusyError'
  }
}
