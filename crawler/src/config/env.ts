import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/**
 * Biến môi trường của crawler.
 *
 * Cố ý KHÔNG dùng chung `src/config/env.ts` của REST API: crawler là package
 * độc lập, và hai bên cần kiểu kết nối database khác nhau (xem chú thích
 * `CRAWLER_DATABASE_URL` bên dưới).
 *
 * Fail-fast: thiếu hoặc sai kiểu là chết ngay lúc khởi động, thay vì chết giữa
 * chừng sau khi đã crawl 2.000 novel và ghi dở dang.
 */
const envSchema = z.object({
  /**
   * PHẢI là direct connection (port 5432), KHÔNG dùng transaction pooler (6543).
   * Importer chạy transaction trải nhiều câu lệnh cho mỗi novel; pooler ở chế độ
   * transaction không giữ được session xuyên suốt một cách tin cậy.
   */
  CRAWLER_DATABASE_URL: z
    .string({ required_error: 'Thiếu CRAWLER_DATABASE_URL — xem crawler/.env.example' })
    .min(1, 'CRAWLER_DATABASE_URL không được rỗng')
    .refine(
      (url) => url.startsWith('postgres://') || url.startsWith('postgresql://'),
      'CRAWLER_DATABASE_URL phải là connection string PostgreSQL',
    ),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /**
   * Nguồn dùng khi lệnh không truyền `--source`.
   *
   * Có biến này thì `npm run crawl:latest` (và các workflow GitHub Actions) không
   * phải hardcode tên nguồn — đổi nguồn mặc định chỉ cần sửa env, không phải sửa
   * package.json lẫn ba file YAML.
   */
  CRAWL_DEFAULT_SOURCE: z.string().min(1).default('scribblehub'),

  /**
   * Định danh crawler. Bắt buộc có cách liên hệ — vừa là phép lịch sự với site
   * nguồn, vừa là tự bảo vệ: IP của GitHub Actions runner dùng chung, bị chặn
   * thì không tự gỡ được.
   */
  CRAWLER_USER_AGENT: z
    .string()
    .min(10)
    .default('LumiereBot/0.1 (+https://github.com/lumiere; contact@example.com)'),

  /**
   * Trần số chương TẢI NỘI DUNG cho mỗi novel, trong một lần chạy.
   *
   * Mỗi chương là một request riêng. Đặt 0 để tắt hẳn việc tải nội dung.
   */
  CRAWL_CONTENT_CHAPTERS_PER_NOVEL: z.coerce.number().int().min(0).max(5_000).default(50),

  /** Trần số novel xử lý trong MỘT lần chạy (D4: 1.000–5.000 cho mode refresh). */
  CRAWL_MAX_ITEMS_PER_RUN: z.coerce.number().int().min(1).max(50_000).default(1000),

  /**
   * Trần THỜI GIAN cho một lần chạy, tính bằng phút. 0 = không giới hạn.
   *
   * Trần theo SỐ novel là không đủ: một novel 11 chương mất 25 giây, một novel
   * 991 chương mất hơn 2 phút. Cùng `--limit 150` có thể ra 1 giờ hoặc 5 giờ.
   *
   * Quan trọng hơn: adapter lấy HẾT rồi importer mới ghi. Bị runner giết vì quá
   * giờ nghĩa là ghi được ĐÚNG 0 dòng. Có hạn chót thì job tự dừng lấy việc mới,
   * ghi phần đã có, và thoát sạch sẽ — hàng đợi giữ nguyên phần còn lại cho lần
   * sau.
   *
   * Đặt THẤP HƠN `timeout-minutes` của workflow một khoảng đủ để ghi database.
   */
  CRAWL_MAX_RUN_MINUTES: z.coerce.number().int().min(0).max(1440).default(0),

  /** Rate limit lịch sự. Nâng lên là tăng rủi ro bị chặn. */
  CRAWL_MAX_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(30),
  CRAWL_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),

  /** Chạy thử: crawl và normalize bình thường nhưng KHÔNG ghi database. */
  CRAWL_DRY_RUN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type CrawlerEnv = z.infer<typeof envSchema>;

function loadEnv(): CrawlerEnv {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.errors
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`[crawler/config] Cấu hình môi trường không hợp lệ:\n${details}`);
  }

  return parsed.data;
}

export const env: CrawlerEnv = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
