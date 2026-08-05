import { closePool, query } from '../database/pool.js';
import { withTransaction } from '../database/transaction.js';

/**
 * Xoá dữ liệu seed còn sót, giữ nguyên dữ liệu crawl.
 *
 *   npx tsx src/dev/purge-seed.ts          # chỉ ĐẾM, không xoá
 *   npx tsx src/dev/purge-seed.ts --apply  # thực sự xoá
 *
 * CÁCH PHÂN BIỆT: novel do crawler ghi luôn có một dòng trong `novel_sources`
 * (cặp nguồn + id bên nguồn). Novel seed thì không — chúng được chèn thẳng bằng
 * seed.sql. Đó là dấu hiệu chắc chắn, không phải đoán theo slug hay tiêu đề.
 *
 * ⚠️ Xoá novel sẽ CASCADE sang bookmark, tiến độ đọc, chương và sự kiện sync của
 * chính những novel đó. Đúng như mong muốn — chúng biến mất cùng novel.
 */
const apply = process.argv.includes('--apply');

const SEED_FILTER = 'WHERE id NOT IN (SELECT novel_id FROM novel_sources)';

interface CountRow {
  novels: string;
  chapters: string;
  bookmarks: string;
  progress: string;
  events: string;
}

const [counts] = await query<CountRow>(`
  SELECT
    (SELECT COUNT(*) FROM novels ${SEED_FILTER})::text AS novels,
    (SELECT COUNT(*) FROM chapters c
      WHERE c.novel_id IN (SELECT id FROM novels ${SEED_FILTER}))::text AS chapters,
    (SELECT COUNT(*) FROM bookmarks b
      WHERE b.novel_id IN (SELECT id FROM novels ${SEED_FILTER}))::text AS bookmarks,
    (SELECT COUNT(*) FROM reading_progress rp
      WHERE rp.novel_id IN (SELECT id FROM novels ${SEED_FILTER}))::text AS progress,
    (SELECT COUNT(*) FROM sync_events se
      WHERE se.novel_id IN (SELECT id FROM novels ${SEED_FILTER}))::text AS events
`);

const kept = await query<{ n: string }>(
  'SELECT COUNT(*)::text AS n FROM novels WHERE id IN (SELECT novel_id FROM novel_sources)',
);

console.log('\nSẼ XOÁ (dữ liệu seed — không có trong novel_sources)');
console.log(`  novels           : ${counts?.novels ?? 0}`);
console.log(`  chapters         : ${counts?.chapters ?? 0}   (CASCADE)`);
console.log(`  bookmarks        : ${counts?.bookmarks ?? 0}   (CASCADE)`);
console.log(`  reading_progress : ${counts?.progress ?? 0}   (CASCADE)`);
console.log(`  sync_events      : ${counts?.events ?? 0}   (CASCADE)`);
console.log(`\nGIỮ LẠI (dữ liệu crawl)\n  novels           : ${kept[0]?.n ?? 0}`);

const seedNovels = Number.parseInt(counts?.novels ?? '0', 10);

if (seedNovels === 0) {
  console.log('\nKhông còn dữ liệu seed nào. Không cần làm gì.');
} else if (!apply) {
  console.log('\nĐây là chế độ XEM TRƯỚC. Chạy lại với --apply để thực sự xoá.');
} else {
  const removed = await withTransaction(async (client) => {
    /*
     * Xoá luôn sync_runs mồ côi của seed (source_id NULL) — chúng làm bẩn
     * GET /api/timeline/stats, nhất là dòng 'running' 74% không bao giờ kết thúc.
     */
    await client.query(`DELETE FROM sync_runs WHERE source_id IS NULL`);
    const result = await client.query(`DELETE FROM novels ${SEED_FILTER}`);
    return result.rowCount ?? 0;
  });

  console.log(`\n✅ Đã xoá ${removed} novel seed cùng dữ liệu liên quan.`);
  console.log('   Nhóm dịch và genre của seed được giữ lại — chúng vô hại và');
  console.log('   có thể được dữ liệu crawl dùng lại.');
}

await closePool();
