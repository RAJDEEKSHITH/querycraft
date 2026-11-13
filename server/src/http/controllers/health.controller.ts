import type { Request, Response } from 'express'
import { checkHealth } from '../../services/health.service.js'

export async function getHealth(req: Request, res: Response): Promise<void> {
  const report = await checkHealth(req.log)
  res.status(report.status === 'ok' ? 200 : 503).json(report)
}
