import type { Request, Response } from 'express';
import * as libraryService from '../services/library.service';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/response';

function requiredUserId(req: Request): string {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.userId;
}

/** GET /api/library/bookmarks — protected */
export async function bookmarks(req: Request, res: Response): Promise<void> {
  const items = await libraryService.getBookmarks(requiredUserId(req));
  sendSuccess(res, { items, total: items.length });
}

/** GET /api/library/history — protected */
export async function history(req: Request, res: Response): Promise<void> {
  const items = await libraryService.getHistory(requiredUserId(req));
  sendSuccess(res, { items, total: items.length });
}

/** POST /api/translation-groups/:slug/follow — protected */
export async function followGroup(req: Request, res: Response): Promise<void> {
  const { slug } = req.params as { slug: string };
  const result = await libraryService.followGroup(slug, requiredUserId(req));
  sendSuccess(res, result);
}

/** DELETE /api/translation-groups/:slug/follow — protected */
export async function unfollowGroup(req: Request, res: Response): Promise<void> {
  const { slug } = req.params as { slug: string };
  const result = await libraryService.unfollowGroup(slug, requiredUserId(req));
  sendSuccess(res, result);
}