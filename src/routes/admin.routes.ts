import { Router } from 'express';
import * as adminController from '../controllers/admin.controller';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

/**
 * Toàn bộ nhánh /api/admin cần đăng nhập VÀ có quyền admin.
 *
 * Đặt hai middleware ở cấp router thay vì lặp lại trên từng route: thêm endpoint
 * mới sau này sẽ tự động được bảo vệ, không phụ thuộc vào việc người viết có nhớ
 * gắn hay không. Quên gắn auth là lỗi im lặng và nguy hiểm.
 *
 * Không có endpoint nào cho phép tự nâng quyền — muốn có admin thì phải chạm tay
 * vào database (xem database/seed-users.sql).
 */
router.use(requireAuth, requireRole('admin'));

router.get('/stats', asyncHandler(adminController.stats));

export default router;
