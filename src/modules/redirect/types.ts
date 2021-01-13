import { Request, Response } from 'express'

export type RedirectConfig = {
  REDIRECT_URL: string
}

export type IRedirectComponent = (req: Request, res: Response) => void
