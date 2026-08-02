import type { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema';
import { ApiError } from '../utils/ApiError';
import { sendSuccess } from '../utils/response';

/** POST /api/auth/register */
export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body as RegisterInput);
  sendSuccess(res, result, 201);
}

/** POST /api/auth/login */
export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body as LoginInput);
  sendSuccess(res, result);
}

/** GET /api/auth/me — protected */
export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) throw ApiError.unauthorized();
  const result = await authService.getMe(req.user.userId);
  sendSuccess(res, result);
}