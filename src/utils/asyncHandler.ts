import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 KHÔNG tự bắt promise rejection từ async handler — lỗi sẽ trở thành
 * unhandled rejection và request treo cho tới khi timeout. Wrapper này chuyển
 * mọi rejection về `next(err)` để error middleware xử lý.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}