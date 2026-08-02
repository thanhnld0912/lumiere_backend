import { Router } from 'express';
import * as libraryController from '../controllers/library.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// Toàn bộ library là dữ liệu riêng của user -> requireAuth cho cả router.
router.use(requireAuth);

router.get('/bookmarks', asyncHandler(libraryController.bookmarks));
router.get('/history', asyncHandler(libraryController.history));

export default router;