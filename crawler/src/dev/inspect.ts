/**
 * Soi dữ liệu crawler vừa ghi.
 *
 *   npm run inspect             -- xem toàn cảnh
 *   npm run inspect -- crimson  -- lọc theo slug
 *
 * Tồn tại vì `npm run crawl` chỉ báo "tạo mới: 1" — nó không cho biết dữ liệu
 * đã nằm ĐÚNG CHỖ trong 7 bảng hay chưa. Công cụ này trả lời câu đó.
 */
import { closePool, query } from '../database/index.js';

const filter = process.argv[2] ?? '';
const like = `%${filter}%`;

async function section(title: string, rows: readonly unknown[]): Promise<void> {
  console.log(`\n── ${title}`);
  if (rows.length === 0) {
    console.log('   (không có dòng nào)');
    return;
  }
  for (const row of rows) console.log('  ', JSON.stringify(row));
}

async function main(): Promise<void> {
  await section(
    'sources',
    await query('SELECT slug, name, is_enabled FROM sources ORDER BY slug'),
  );

  await section(
    'novels',
    await query(
      `SELECT n.slug, n.title, n.author, n.status, n.total_chapters,
              n.rating::text AS rating, n.ratings_count, n.language,
              s.slug AS primary_source,
              n.last_synced_at IS NOT NULL  AS co_last_synced,
              n.last_chapter_at IS NOT NULL AS co_last_chapter
       FROM novels n
       LEFT JOIN sources s ON s.id = n.primary_source_id
       WHERE n.slug ILIKE $1
       ORDER BY n.created_at DESC LIMIT 10`,
      [like],
    ),
  );

  await section(
    'novel_sources — nền tảng của dedup + update detection',
    await query(
      `SELECT ns.external_id,
              length(ns.content_hash) AS do_dai_hash,
              ns.last_crawled_at IS NOT NULL AS da_crawl,
              ns.last_changed_at IS NOT NULL AS da_tung_doi
       FROM novel_sources ns
       JOIN novels n ON n.id = ns.novel_id
       WHERE n.slug ILIKE $1 LIMIT 10`,
      [like],
    ),
  );

  await section(
    'genres — position phải giữ đúng thứ tự nguồn cho',
    await query(
      `SELECT g.name, ng.position
       FROM novel_genres ng
       JOIN genres g ON g.id = ng.genre_id
       JOIN novels n ON n.id = ng.novel_id
       WHERE n.slug ILIKE $1
       ORDER BY ng.position LIMIT 15`,
      [like],
    ),
  );

  await section(
    'số tag',
    await query(
      `SELECT COUNT(*)::int AS so_tag
       FROM novel_tags nt JOIN novels n ON n.id = nt.novel_id
       WHERE n.slug ILIKE $1`,
      [like],
    ),
  );

  await section(
    'chapters — sort_index và KHÔNG có nội dung (đúng yêu cầu)',
    await query(
      `SELECT c.slug, c.number, c.display_title, c.sort_index::text AS sort_index, c.is_extra,
              EXISTS(SELECT 1 FROM chapter_contents cc WHERE cc.chapter_id = c.id) AS co_noi_dung
       FROM chapters c JOIN novels n ON n.id = c.novel_id
       WHERE n.slug ILIKE $1
       ORDER BY c.sort_index LIMIT 10`,
      [like],
    ),
  );

  await section(
    'sync_runs — feed cho GET /api/timeline/stats',
    await query(
      `SELECT sr.mode, sr.status, sr.progress_percentage, s.slug AS source
       FROM sync_runs sr LEFT JOIN sources s ON s.id = sr.source_id
       ORDER BY sr.started_at DESC LIMIT 5`,
    ),
  );

  await section(
    'sync_events — feed cho GET /api/timeline',
    await query(
      `SELECT n.slug, se.chapters_added_count, se.occurred_at
       FROM sync_events se JOIN novels n ON n.id = se.novel_id
       ORDER BY se.occurred_at DESC LIMIT 5`,
    ),
  );

  console.log('');
}

main()
  .then(() => closePool())
  .catch(async (error: unknown) => {
    console.error(error);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
