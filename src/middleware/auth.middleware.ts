import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { extractBearerToken, verifyAccessToken, type TokenPayload } from '../utils/jwt';

/**
 * Bổ sung `req.user` vào kiểu Request của Express.
 * Optional vì optionalAuth có thể để trống.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Bắt buộc đăng nhập. Không có token, token sai hoặc hết hạn đều là 401.
 * Dùng cho: /auth/me, bookmark, progress, library, follow.
 */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    next(ApiError.unauthorized('Authentication required'));
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Đăng nhập tuỳ chọn — mấu chốt để giải quyết phát hiện F4.
 *
 * Novel list/detail phải xem được khi CHƯA đăng nhập, nhưng nếu có token hợp lệ
 * thì response được bổ sung state riêng của user (isBookmarked,
 * lastReadChapterId, chapter.isRead…) vì frontend nhúng các field đó thẳng
 * trong object Novel.
 *
 * Quan trọng: KHÔNG có header thì đi tiếp, nhưng có header mà token HỎNG thì
 * vẫn 401. Nuốt lỗi token hỏng sẽ khiến người dùng có token hết hạn âm thầm
 * thấy dữ liệu của khách mà không hiểu vì sao bookmark của mình biến mất.
 */
export const optionalAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    next();
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Kiểm tra role. Phải đặt SAU requireAuth.
 * Chưa route nào dùng — để sẵn cho khu vực quản trị crawler sau này.
 */
export function requireRole(...roles: Array<TokenPayload['role']>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(ApiError.unauthorized('Authentication required'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(ApiError.forbidden('You do not have permission to perform this action'));
      return;
    }
    next();
  };
}