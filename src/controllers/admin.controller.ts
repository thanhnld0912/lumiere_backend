import type { Request, Response } from 'express';
import * as adminService from '../services/admin.service';
import { sendSuccess } from '../utils/response';

/** GET /api/admin/stats — cần đăng nhập VÀ quyền admin. */
export async function stats(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await adminService.getOverview());
}
