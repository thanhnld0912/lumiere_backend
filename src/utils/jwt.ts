import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './ApiError';

/**
 * Payload của access token — đúng spec đã chốt:
 *   { userId, email, role }
 */
export interface TokenPayload {
  userId: string;
  email: string;
  role: 'user' | 'admin';
}

/** Ký access token HS256. TTL lấy từ JWT_EXPIRES_IN (mặc định 7d). */
export function signAccessToken(payload: TokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.jwtExpiresIn as SignOptions['expiresIn'],
    algorithm: 'HS256',
  };
  return jwt.sign(payload, env.jwtSecret, options);
}

/**
 * Xác thực token và trả payload.
 *
 * Ném ApiError 401 với message phân biệt được hết hạn vs. không hợp lệ —
 * frontend cần biết để quyết định có nên mở lại form đăng nhập hay không.
 * Chỉ chấp nhận HS256: nếu không khoá thuật toán, token gắn `alg: none`
 * hoặc thuật toán khác có thể qua mặt được.
 */
export function verifyAccessToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });

    if (typeof decoded === 'string') {
      throw ApiError.unauthorized('Invalid token');
    }

    const payload = decoded as JwtPayload & Partial<TokenPayload>;

    if (!payload.userId || !payload.email || !payload.role) {
      throw ApiError.unauthorized('Invalid token payload');
    }

    return {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Token has expired');
    }
    throw ApiError.unauthorized('Invalid token');
  }
}

/**
 * Tách token từ header `Authorization: Bearer <token>`.
 * Trả null nếu header vắng mặt hoặc sai định dạng — người gọi tự quyết định
 * điều đó là lỗi (requireAuth) hay chấp nhận được (optionalAuth).
 */
export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;

  const [scheme, token] = authorizationHeader.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;

  return token.trim() || null;
}