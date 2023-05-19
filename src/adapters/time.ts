export function fromMillisecondsToSeconds(timeInMilliseconds: number): number {
  return Math.floor(timeInMilliseconds / 1000)
}

export function fromSecondsToMilliseconds(timeInSeconds: number): number {
  return timeInSeconds * 1000
}
