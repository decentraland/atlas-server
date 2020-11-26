export interface IConfigComponent<T> {
  getString: (name: keyof T) => string
  getNumber: (name: keyof T) => number
}
