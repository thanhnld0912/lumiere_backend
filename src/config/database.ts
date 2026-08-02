import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { env } from './env';

/**
 * PostgreSQL Pool dùng chung (node-postgres thuần — không ORM).
 *
 * Lưu ý về serverless: mỗi lambda instance trên Vercel có process riêng nên sẽ
 * tạo pool riêng. Nếu để `max` mặc định (10) thì chỉ vài instance đồng thời là
 * cạn connection limit của Supabase. Vì vậy trên production giới hạn `max: 1`
 * và dựa vào Supabase pooler để ghép nối.
 *
 * Pool được cache trên globalThis để tồn tại qua các lần "warm start" của lambda,
 * tránh tạo connection mới cho mỗi request.
 */

const isServerless = Boolean(process.env['VERCEL']);

function createPool(): Pool {
  return new Pool({
    connectionString: env.databaseUrl,
    // Supabase luôn yêu cầu TLS. Certificate là của chuỗi CA nội bộ Supabase nên
    // Node không xác thực được — đây là cấu hình chuẩn cho Supabase + pg.
    ssl: { rejectUnauthorized: false },
    max: isServerless ? 1 : 10,
    idleTimeoutMillis: isServerless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
    // Không để một query treo giữ connection mãi mãi.
    statement_timeout: 15_000,
  });
}

// Cache qua warm start của serverless.
const globalForPool = globalThis as typeof globalThis & { __lumierePool?: Pool };

export const pool: Pool = globalForPool.__lumierePool ?? createPool();

if (!globalForPool.__lumierePool) {
  globalForPool.__lumierePool = pool;

  // Lỗi trên idle client (VD DB restart) không được làm sập process.
  pool.on('error', (err: Error) => {
    console.error('[database] Lỗi trên idle client:', err.message);
  });
}

/**
 * Query helper. Luôn dùng tham số hoá ($1, $2, …) — không bao giờ nối chuỗi SQL.
 *
 * @example
 *   const rows = await query<NovelRow>('SELECT * FROM novels WHERE slug = $1', [slug]);
 */
/**
 * Kiểm tra số tham số truyền vào có khớp số placeholder cao nhất trong SQL không.
 *
 * Postgres đánh số tham số theo TỪNG prepared statement, nên việc dùng lại một
 * mảng params cho hai câu SQL khác nhau sẽ nổ ra lỗi khó đọc:
 *   "bind message supplies N parameters, but prepared statement "" requires M"
 *
 * Guard này biến lỗi đó thành thông báo chỉ thẳng vào câu SQL sai. Chỉ chạy ở
 * môi trường dev — production bỏ qua để không tốn regex trên mỗi query.
 */
function assertParamCount(text: string, params: readonly unknown[]): void {
  // Bỏ qua chuỗi literal và dollar-quoted block để không đếm nhầm '$1' trong text.
  const sanitised = text.replace(/'(?:[^']|'')*'/g, "''").replace(/\$\$[\s\S]*?\$\$/g, '');

  let maxPlaceholder = 0;
  for (const match of sanitised.matchAll(/\$(\d+)/g)) {
    const index = Number.parseInt(match[1] ?? '0', 10);
    if (index > maxPlaceholder) maxPlaceholder = index;
  }

  if (maxPlaceholder !== params.length) {
    throw new Error(
      `[database] Sai parameter mapping: SQL cần ${maxPlaceholder} tham số ` +
        `nhưng nhận được ${params.length}.\nSQL: ${text.trim().slice(0, 300)}`,
    );
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  if (!env.isProduction) assertParamCount(text, params);

  const start = Date.now();
  const result: QueryResult<T> = await pool.query<T>(text, params as unknown[]);

  if (!env.isProduction) {
    const duration = Date.now() - start;
    if (duration > 200) {
      console.warn(`[database] Query chậm (${duration}ms): ${text.slice(0, 120)}…`);
    }
  }

  return result.rows;
}

/**
 * Query trả về đúng một dòng, hoặc null nếu không có.
 */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Chạy nhiều câu lệnh trong một transaction. Tự động COMMIT khi thành công,
 * ROLLBACK khi callback ném lỗi.
 *
 * Cần cho PUT …/progress vì endpoint đó ghi vào 2 bảng
 * (chapter_reads + reading_progress) và phải nguyên tử.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Đóng pool — chỉ dùng khi tắt server local hoặc trong test. */
export async function closePool(): Promise<void> {
  await pool.end();
  delete globalForPool.__lumierePool;
}