import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

/**
 * Pool PostgreSQL RIÊNG của crawler.
 *
 * Cố ý KHÔNG import từ `../../src/config/database.ts` của REST API. Hai lý do:
 *
 * 1. Cô lập — crawler là package độc lập; import chéo sẽ kéo cả cây phụ thuộc
 *    của API vào đây và phá vỡ điều đó.
 *
 * 2. Tuning ngược nhau. API chạy serverless: `max: 1`, đời sống ngắn, dùng
 *    transaction pooler (6543). Crawler chạy batch: pool lớn hơn, transaction
 *    dài, BẮT BUỘC direct connection (5432) — pooler ở chế độ transaction không
 *    giữ được session xuyên suốt nhiều câu lệnh một cách tin cậy.
 *
 * Vai trò cũng tách bạch: crawler CHỈ GHI, API CHỈ ĐỌC.
 */
export const pool = new Pool({
  connectionString: env.CRAWLER_DATABASE_URL,
  // Supabase luôn yêu cầu TLS; certificate thuộc chuỗi CA nội bộ nên Node không
  // xác thực được — đây là cấu hình chuẩn cho Supabase + pg.
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  // Rộng hơn API (15s) vì importer chạy upsert nhiều bảng trong một transaction.
  statement_timeout: 30_000,
});

// Lỗi trên idle client (VD Supabase restart) không được làm sập tiến trình giữa
// lúc đang crawl dở 3.000 novel.
pool.on('error', (error: Error) => {
  logger.error({ err: error.message }, 'lỗi trên idle client của pool');
});

/**
 * Kiểm tra số tham số khớp số placeholder cao nhất trong SQL.
 *
 * Postgres đánh số tham số theo TỪNG prepared statement, nên dùng lại một mảng
 * params cho hai câu SQL khác nhau sẽ nổ ra lỗi rất khó đọc:
 *   "bind message supplies N parameters, but prepared statement requires M"
 *
 * REST API đã dính đúng lỗi này một lần. Đưa guard vào ngay từ đầu ở crawler.
 */
function assertParamCount(text: string, params: readonly unknown[]): void {
  const sanitised = text.replace(/'(?:[^']|'')*'/g, "''").replace(/\$\$[\s\S]*?\$\$/g, '');

  let maxPlaceholder = 0;
  for (const match of sanitised.matchAll(/\$(\d+)/g)) {
    const index = Number.parseInt(match[1] ?? '0', 10);
    if (index > maxPlaceholder) maxPlaceholder = index;
  }

  if (maxPlaceholder !== params.length) {
    throw new Error(
      `[database] Sai parameter mapping: SQL cần ${maxPlaceholder} tham số ` +
        `nhưng nhận ${params.length}.\nSQL: ${text.trim().slice(0, 300)}`,
    );
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  assertParamCount(text, params);
  const result = await pool.query<T>(text, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Kiểm tra kết nối. Dùng lúc khởi động để fail sớm thay vì fail giữa chừng. */
export async function checkConnection(): Promise<{ version: string; database: string }> {
  const row = await queryOne<{ version: string; database: string }>(
    'SELECT version() AS version, current_database() AS database',
  );
  if (!row) {
    throw new Error('[database] SELECT không trả về dòng nào');
  }
  return row;
}

export async function closePool(): Promise<void> {
  await pool.end();
}
