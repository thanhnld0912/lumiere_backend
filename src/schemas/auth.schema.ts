import { z } from 'zod';
import { MAX_PASSWORD_BYTES } from '../utils/password';

/**
 * Đếm độ dài mật khẩu theo BYTE, không theo ký tự — bcrypt cắt ở 72 byte và
 * một ký tự tiếng Việt có dấu chiếm 2-3 byte UTF-8. Nếu chỉ kiểm tra `.max(72)`
 * theo ký tự thì mật khẩu tiếng Việt dài vẫn bị cắt âm thầm.
 */
const passwordByteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

const passwordField = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .refine(
    (value) => passwordByteLength(value) <= MAX_PASSWORD_BYTES,
    `Password must not exceed ${MAX_PASSWORD_BYTES} bytes`,
  );

const emailField = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(255, 'Email must not exceed 255 characters')
  .email('Invalid email address');

export const registerSchema = z.object({
  email: emailField,
  password: passwordField,
  displayName: z
    .string({ required_error: 'Display name is required' })
    .trim()
    .min(2, 'Display name must be at least 2 characters')
    .max(80, 'Display name must not exceed 80 characters'),
});

export const loginSchema = z.object({
  email: emailField,
  // Login KHÔNG áp ràng buộc độ mạnh: mật khẩu cũ có thể không thoả quy tắc mới,
  // và thông báo "mật khẩu quá ngắn" ở màn đăng nhập là một kênh rò rỉ thông tin.
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;