import type { Request, Response } from 'express';
import type { NovelQueryInput, ProgressInput } from '../schemas/novel.schema';
import * as chapterService from '../services/chapter.service';
import * as libraryService from '../services/library.service';
import * as novelService from '../services/novel.service';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/response';

/**
 * Lấy userId từ request đã qua optionalAuth. Trả null khi là khách —
 * service dùng giá trị này để quyết định có merge state per-user hay không (F4).
 */
function optionalUserId(req: Request): string | null {
  return req.user?.userId ?? null;
}

/** Lấy userId từ request đã qua requireAuth. */
function requiredUserId(req: Request): string {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.userId;
}

/** GET /api/novels */
export async function list(req: Request, res: Response): Promise<void> {
  const result = await novelService.listNovels(
    req.query as NovelQueryInput,
    optionalUserId(req),
  );
  sendSuccess(res, result);
}

/** GET /api/novels/:slug */
export async function detail(req: Request, res: Response): Promise<void> {
  const { slug } = req.params as { slug: string };
  const result = await novelService.getNovelBySlug(slug, optionalUserId(req));
  sendSuccess(res, result);
}

/** GET /api/novels/:slug/chapters/:chapterSlug */
export async function chapter(req: Request, res: Response): Promise<void> {
  const { slug, chapterSlug } = req.params as { slug: string; chapterSlug: string };
  const result = await chapterService.getChapter(slug, chapterSlug, optionalUserId(req));
  sendSuccess(res, result);
}

/** PUT /api/novels/:slug/chapters/:chapterSlug/progress — protected */
export async function updateProgress(req: Request, res: Response): Promise<void> {
  const { slug, chapterSlug } = req.params as { slug: string; chapterSlug: string };
  const { progress } = req.body as ProgressInput;

  const result = await chapterService.updateProgress(
    slug,
    chapterSlug,
    progress,
    requiredUserId(req),
  );
  sendSuccess(res, result);
}

/** POST /api/novels/:slug/bookmark — protected */
export async function addBookmark(req: Request, res: Response): Promise<void> {
  const { slug } = req.params as { slug: string };
  const result = await libraryService.addBookmark(slug, requiredUserId(req));
  sendSuccess(res, result);
}

/** DELETE /api/novels/:slug/bookmark — protected */
export async function removeBookmark(req: Request, res: Response): Promise<void> {
  const { slug } = req.params as { slug: string };
  const result = await libraryService.removeBookmark(slug, requiredUserId(req));
  sendSuccess(res, result);
}