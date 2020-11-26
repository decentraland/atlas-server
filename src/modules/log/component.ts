import { ILogComponent } from './types'

export function createLogComponent(): ILogComponent {
  return (message) => console.log(message)
}
