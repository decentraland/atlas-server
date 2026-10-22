export function isErrorWithMessage(error: unknown): error is Error {
  return (
    error !== undefined &&
    error !== null &&
    typeof error === 'object' &&
    'message' in error!
  )
}

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRequestError'
  }
}
