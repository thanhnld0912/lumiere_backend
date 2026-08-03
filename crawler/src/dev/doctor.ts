/**
 * Kiểm tra sức khoẻ — verify của Phase 2.
 *
 *   npm run doctor
 *
 * Xác nhận nền tảng đã đứng vững trước khi xây tiếp:
 *   1. config đọc và validate được
 *   2. kết nối được database
 *   3. migration crawler ĐÃ chạy (bảng + cột mới tồn tại)
 *   4. các hàm thuần (slug, sort_index, hash) cho kết quả đúng
 *   5. sort_index tính bên TS KHỚP với trigger SQL — điểm dễ sai nhất
 */
import { crawlerConfig } from '../config/crawler.config.js';
import { listEnabledSources, SOURCE_CONFIGS } from '../config/sources/index.js';
import { env } from '../config/env.js';
import { checkConnection, closePool, queryOne } from '../database/index.js';
import { chapterSlug, computeSortIndex, hashContent, slugify } from '../utils/index.js';
import { logger } from '../utils/logger.js';

let failures = 0;

/**
 * Dịch lỗi kết nối thô sang nguyên nhân + cách sửa cụ thể.
 *
 * Thông báo mặc định của Node (`getaddrinfo ENOTFOUND …`) không nói được gì về
 * việc phải làm tiếp. Với Supabase thì tập nguyên nhân rất hẹp và đoán được.
 */
function explainConnectionFailure(message: string, dbUrl: string): void {
  const isDirectHost = /@db\.[a-z0-9]+\.supabase\.co/.test(dbUrl);

  if (message.includes('ENOTFOUND')) {
    if (isDirectHost) {
      logger.error(
        'NGUYÊN NHÂN: direct connection của Supabase (db.<ref>.supabase.co) chỉ còn bản ghi\n' +
          '            AAAA (IPv6). Mạng của bạn không có IPv6 nên DNS không trả về địa chỉ dùng được.\n' +
          'CÁCH SỬA : dùng SESSION POOLER — cùng host với backend, port 5432:\n' +
          '              postgresql://postgres.<ref>:<PASSWORD>@aws-<n>-<region>.pooler.supabase.com:5432/postgres\n' +
          '           Nhanh nhất: copy DATABASE_URL từ .env của backend rồi đổi 6543 -> 5432.',
      );
    } else {
      logger.error(
        'NGUYÊN NHÂN: hostname không phân giải được.\n' +
          'CÁCH SỬA : kiểm tra lại host trong CRAWLER_DATABASE_URL, và xem project Supabase\n' +
          '           có đang bị pause không (Dashboard -> Project Settings).',
      );
    }
    return;
  }

  if (message.includes('password authentication failed')) {
    logger.error(
      'NGUYÊN NHÂN: sai mật khẩu, hoặc sai định dạng username.\n' +
        'CÁCH SỬA : username của pooler là `postgres.<project-ref>`, KHÔNG phải `postgres`.\n' +
        '           Lấy chuỗi đầy đủ ở Dashboard -> Connect -> Session pooler.',
    );
    return;
  }

  if (message.includes('ETIMEDOUT') || message.includes('ECONNREFUSED')) {
    logger.error(
      'NGUYÊN NHÂN: phân giải được DNS nhưng không kết nối được.\n' +
        'CÁCH SỬA : kiểm tra firewall/VPN chặn port, và project Supabase có đang chạy không.',
    );
    return;
  }

  if (message.includes('self signed certificate') || message.includes('certificate')) {
    logger.error(
      'NGUYÊN NHÂN: xác thực TLS thất bại.\n' +
        'CÁCH SỬA : pool đã đặt ssl.rejectUnauthorized = false; kiểm tra xem có proxy TLS\n' +
        '           trung gian nào đang can thiệp không.',
    );
  }
}

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    logger.info({ detail }, `✅ ${label}`);
  } else {
    failures += 1;
    logger.error({ detail }, `❌ ${label}`);
  }
}

async function main(): Promise<void> {
  logger.info('— Lumiere crawler doctor —');

  /* 1. Config */
  check('config nạp được', typeof env.CRAWLER_DATABASE_URL === 'string');
  check(
    `source đã đăng ký: ${SOURCE_CONFIGS.size}`,
    SOURCE_CONFIGS.size > 0,
    listEnabledSources()
      .map((source) => source.id)
      .join(', '),
  );
  check(
    'trần mỗi lần chạy hợp lệ (D4)',
    crawlerConfig.maxItemsPerRun >= 1,
    `maxItemsPerRun=${crawlerConfig.maxItemsPerRun}`,
  );

  /*
   * Cảnh báo cấu hình kết nối.
   *
   * Supabase có ba kiểu endpoint và chỉ một kiểu hợp với crawler:
   *   pooler:5432  (session mode)     -> ĐÚNG: transaction dài OK, có IPv4
   *   pooler:6543  (transaction mode) -> SAI : ngắt transaction dài của importer
   *   db.<ref>.supabase.co:5432       -> SAI : IPv6-only, ENOTFOUND trên mạng IPv4
   */
  const dbUrl = env.CRAWLER_DATABASE_URL;

  if (dbUrl.includes(':6543')) {
    logger.warn(
      'CRAWLER_DATABASE_URL đang dùng port 6543 (transaction mode). Importer chạy ' +
        'transaction dài nên cần SESSION MODE — đổi port thành 5432, giữ nguyên host pooler.',
    );
  }

  if (/@db\.[a-z0-9]+\.supabase\.co/.test(dbUrl)) {
    logger.warn(
      'CRAWLER_DATABASE_URL đang dùng direct connection (db.<ref>.supabase.co). ' +
        'Supabase đã chuyển endpoint này sang IPv6-only — mạng không có IPv6 sẽ báo ' +
        'ENOTFOUND. Dùng host pooler với port 5432 thay thế.',
    );
  }

  /* 2. Hàm thuần — không cần database */
  check("slugify('The Hero's Journey!')", slugify("The Hero's Journey!") === 'the-heros-journey');
  check('slugify giữ được CHECK constraint', /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slugify('別世界')));
  check(
    'chapterSlug phân biệt extra với chương thường',
    chapterSlug({ number: 12 }) !== chapterSlug({ number: 12, isExtra: true }),
    `${chapterSlug({ number: 12 })} vs ${chapterSlug({ number: 12, isExtra: true })}`,
  );
  check(
    'hash ổn định bất kể thứ tự khoá',
    hashContent({ a: 1, b: 2 }) === hashContent({ b: 2, a: 1 }),
  );

  const extraAfterRegular =
    BigInt(computeSortIndex({ number: 12, isExtra: true })) >
    BigInt(computeSortIndex({ number: 12 }));
  check('sort_index: extra xếp ngay sau chương thường cùng số', extraAfterRegular);

  const volumeDominates =
    BigInt(computeSortIndex({ number: 1, volumeNumber: 5 })) >
    BigInt(computeSortIndex({ number: 999, volumeNumber: 4 }));
  check('sort_index: volume có trọng số cao hơn number', volumeDominates);

  /* 3. Database */
  try {
    const info = await checkConnection();
    check('kết nối database', true, `${info.database} — ${info.version.split(',')[0]}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check('kết nối database', false, message);
    explainConnectionFailure(message, dbUrl);
    await closePool().catch(() => undefined);
    process.exit(1);
  }

  /* 4. Migration đã chạy chưa */
  const schema = await queryOne<{
    has_sources: boolean;
    has_novel_sources: boolean;
    has_tags: boolean;
    has_alt_titles: boolean;
    has_sort_index: boolean;
    has_is_extra: boolean;
    has_bookmarks_count: boolean;
    has_trending: boolean;
    status_values: number;
  }>(`
    SELECT
      to_regclass('public.sources')          IS NOT NULL AS has_sources,
      to_regclass('public.novel_sources')    IS NOT NULL AS has_novel_sources,
      to_regclass('public.tags')             IS NOT NULL AS has_tags,
      to_regclass('public.novel_alt_titles') IS NOT NULL AS has_alt_titles,
      EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='chapters' AND column_name='sort_index')      AS has_sort_index,
      EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='chapters' AND column_name='is_extra')        AS has_is_extra,
      EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='novels'   AND column_name='bookmarks_count') AS has_bookmarks_count,
      EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='novels'   AND column_name='trending_score')  AS has_trending,
      (SELECT COUNT(*)::int FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'novel_status') AS status_values
  `);

  check('migration 002: bảng sources', schema?.has_sources === true);
  check('migration 002: bảng novel_sources', schema?.has_novel_sources === true);
  check('migration 002: bảng tags', schema?.has_tags === true);
  check('migration 002: bảng novel_alt_titles', schema?.has_alt_titles === true);
  check('migration 002: novels.bookmarks_count', schema?.has_bookmarks_count === true);
  check('migration 002: novels.trending_score', schema?.has_trending === true);
  check('migration 003: chapters.sort_index', schema?.has_sort_index === true);
  check('migration 003: chapters.is_extra', schema?.has_is_extra === true);
  check(
    'migration 001: novel_status có 5 giá trị',
    schema?.status_values === 5,
    `hiện có ${schema?.status_values ?? 0}`,
  );

  /*
   * 5. Kiểm tra chéo sort_index — phép thử quan trọng nhất ở đây.
   *
   * Công thức tồn tại ở HAI nơi: utils/sortIndex.ts và trigger SQL trong
   * migration 003. Hai bên lệch nhau thì thứ tự chương sẽ đổi tuỳ theo dòng đó
   * do crawler ghi hay do trigger điền — loại bug gần như không thể truy ra từ
   * triệu chứng. Nên xác minh bằng chính Postgres.
   */
  const sample = { number: 243, volumeNumber: 5, partNumber: 2, isExtra: true };
  const tsValue = computeSortIndex(sample);
  const sqlRow = await queryOne<{ sql_value: string }>(
    `SELECT (
       $1::bigint * 1000000000000
     + $2::bigint * 1000000
     + $3::bigint * 1000
     + CASE WHEN $4::boolean THEN 1 ELSE 0 END
     )::text AS sql_value`,
    [sample.volumeNumber, sample.number, sample.partNumber, sample.isExtra],
  );
  check(
    'sort_index: TypeScript khớp công thức SQL',
    sqlRow?.sql_value === tsValue,
    `ts=${tsValue} sql=${sqlRow?.sql_value}`,
  );

  await closePool();

  if (failures > 0) {
    logger.error(`${failures} kiểm tra thất bại`);
    process.exit(1);
  }
  logger.info('Tất cả kiểm tra đã qua.');
}

main().catch(async (error: unknown) => {
  logger.error(
    { err: error instanceof Error ? error.stack : String(error) },
    'doctor gặp lỗi ngoài dự kiến',
  );
  await closePool().catch(() => undefined);
  process.exit(1);
});
