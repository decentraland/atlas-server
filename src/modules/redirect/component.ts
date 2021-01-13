import { Request, Response } from 'express'
import { IConfigComponent } from '../config/types'
import {
  IRedirectComponent as IRedirectComponent,
  RedirectConfig as RedirectConfig,
} from './types'

export function createRedirectComponent(components: {
  config: IConfigComponent<RedirectConfig>
}): IRedirectComponent {
  const { config } = components
  const baseUrl = config.getString('REDIRECT_URL')
  async function redirect(req: Request, res: Response) {
    const newUrl = baseUrl + req.originalUrl
    res.redirect(newUrl)
  }

  return redirect
}
