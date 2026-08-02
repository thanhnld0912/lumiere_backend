import type { Request, Response } from 'express';
import * as timelineService from '../services/timeline.service';
import { sendSuccess } from '../utils/response';

/** GET /api/timeline */
export async function list(_req: Request, res: Response): Promise<void> {
  const items = await timelineService.getTimeline();
  sendSuccess(res, { items });
}

/** GET /api/timeline/stats */
export async function stats(_req: Request, res: Response): Promise<void> {
  const result = await timelineService.getSyncStats();
  sendSuccess(res, result);
}