import dotenv from 'dotenv';

dotenv.config();

/**
 * Đọc biến môi trường BẮT BUỘC. Thiếu là fail-fast ngay lúc khởi động —
 * tốt hơn nhiều so với việc lỗi 500 bí ẩn ở request đầu tiên trên production.
 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `[config] Thiếu biến môi trường bắt buộc: ${name}. ` +
        `Xem .env.example để biết cách cấu hình.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value;
}

const nodeEnv = optional('NODE_ENV', 'development');

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',

  port: Number.parseInt(optional('PORT', '4000'), 10),

  databaseUrl: required('DATABASE_URL'),

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '7d'),

  /**
   * Danh sách origin được phép gọi API. Frontend Vite dev chạy ở port 3000
   * (xem package.json của frontend: `vite --port=3000`).
   */
  corsOrigins: optional('FRONTEND_URL', 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
} as const;

/**
 * Cảnh báo về secret yếu. Không chặn khởi động ở môi trường dev, nhưng
 * production thì phải chặn — secret ngắn là lỗ hổng thật sự.
 */
if (env.jwtSecret.length < 32) {
  const message =
    '[config] JWT_SECRET ngắn hơn 32 ký tự. Sinh secret mạnh bằng: ' +
    'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"';
  if (env.isProduction) {
    throw new Error(message);
  }
  console.warn(`⚠️  ${message}`);
}