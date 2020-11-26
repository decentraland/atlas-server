require('dotenv').config()
import { IConfigComponent } from './types'

export function createConfigComponent<T extends object>(
  options: Partial<T>,
  defaultValues: Partial<T> = {}
): IConfigComponent<T> {
  return {
    getString(name) {
      const defaultValue = defaultValues[name] as string | undefined
      const value = name in options ? options[name] : defaultValue
      if (value === undefined) {
        throw new Error(`Required env variable "${name}" is missing`)
      }
      return value as string
    },
    getNumber(name) {
      const defaultValue = defaultValues[name] as number | undefined
      const value =
        name in options ? parseInt(options[name] as any, 10) : defaultValue
      if (value === undefined) {
        throw new Error(`Required env variable "${name}" is missing`)
      } else if (isNaN(value)) {
        throw new Error(`Required env variable "${name}" should be numeric`)
      }
      return value
    },
  }
}
