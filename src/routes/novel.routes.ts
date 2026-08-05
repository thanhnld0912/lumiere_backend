import { Router } from 'express';
import * as novelController from '../controllers/novel.controller';
import { optionalAuth, requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import {
  chapterParamSchema,
  novelQuerySchema,
  novelSlugParamSchema,
  progressSchema,
} from '../schemas/novel.schema';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

/**
 * Route công khai — dùng optionalAuth: xem được khi chưa đăng nhập, nhưng nếu
 * có token hợp lệ thì response kèm theo state riêng của user (F4).
 */
router.get(
  '/',
  optionalAuth,
  validate(novelQuerySchema, 'query'),
  asyncHandler(novelController.list),
);

router.get(
  '/:slug',
  optionalAuth,
  validate(novelSlugParamSchema, 'params'),
  asyncHandler(novelController.detail),
);

/**
 * Nội dung chương — CẦN ĐĂNG NHẬP.
 *
 * Khác với danh sách và trang chi tiết (xem được khi chưa đăng nhập): đọc truyện
 * là tính năng dành cho thành viên. Duyệt và tìm kiếm vẫn mở để khách biết thư
 * viện có gì, nhưng mở một chương ra đọc thì phải có tài khoản.
 *
 * Chapter BẮT BUỘC nested dưới novel: chapter slug không unique toàn cục (F2).
 */
router.get(
  '/:slug/chapters/:chapterSlug',
  requireAuth,
  validate(chapterParamSchema, 'params'),
  asyncHandler(novelController.chapter),
);

/* ── Route cần đăng nhập ───────────────────────────────────── */

router.put(
  '/:slug/chapters/:chapterSlug/progress',
  requireAuth,
  validate(chapterParamSchema, 'params'),
  validate(progressSchema, 'body'),
  asyncHandler(novelController.updateProgress),
);

router.post(
  '/:slug/bookmark',
  requireAuth,
  validate(novelSlugParamSchema, 'params'),
  asyncHandler(novelController.addBookmark),
);

router.delete(
  '/:slug/bookmark',
  requireAuth,
  validate(novelSlugParamSchema, 'params'),
  asyncHandler(novelController.removeBookmark),
);

export default router;