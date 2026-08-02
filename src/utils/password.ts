import bcrypt from 'bcryptjs';

/**
 * Cost factor. 12 là mức cân bằng hợp lý giữa an toàn và độ trễ (~250ms trên
 * phần cứng hiện đại). Không nên tăng cao hơn trên serverless vì hàm băm chạy
 * đồng bộ và sẽ ăn vào thời gian thực thi của lambda.
 */
const SALT_ROUNDS = 12;

/**
 * bcrypt chỉ dùng 72 byte đầu của mật khẩu và im lặng cắt phần còn lại.
 * Vì vậy zod schema chặn ngay ở tầng validation thay vì để người dùng tưởng
 * mật khẩu 100 ký tự của họ được dùng trọn vẹn.
 */
export const MAX_PASSWORD_BYTES = 72;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(
  plainPassword: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}