import { Router } from 'express';
import * as timelineController from '../controllers/timeline.controller';
import { optionalAuth } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// Công khai. Dùng optionalAuth để token hỏng vẫn báo 401 thay vì âm thầm bỏ qua.
router.use(optionalAuth);

// '/stats' phải khai báo TRƯỚC route động, nếu không sẽ bị nuốt mất.
router.get('/stats', asyncHandler(timelineController.stats));
router.get('/', asyncHandler(timelineController.list));

export default router;