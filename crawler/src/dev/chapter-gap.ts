import { closePool, query } from '../database/pool.js';

/**
 * So sánh số chương nguồn KHAI BÁO với số dòng THỰC TẾ trong bảng chapters.
 *
 *   npx tsx src/dev/chapter-gap.ts
 *
 * Chênh lệch lớn nghĩa là crawler mới lưu chương mới nhất chứ chưa lấy đủ danh
 * sách — người đọc sẽ chỉ thấy đúng một chương trong mục lục.
 */
interface Row {
  slug: string;
  title: string;
  nguon_bao: number;
  trong_db: string;
  la_crawl: boolean;
}

const rows = await query<Row>(`
  SELECT n.slug, n.title, n.total_chapters AS nguon_bao,
         (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id)::text AS trong_db,
         (n.primary_source_id IS NOT NULL) AS la_crawl
  FROM novels n
  ORDER BY (n.primary_source_id IS NOT NULL) DESC, n.total_chapters DESC
`);

const crawled = rows.filter((r) => r.la_crawl);
const seeded = rows.filter((r) => !r.la_crawl);

console.log(`\nDỮ LIỆU CRAWL (${crawled.length} novel)`);
console.log('  nguồn báo │ trong DB │ novel');
console.log('  ──────────┼──────────┼──────────────────────────────');
let missing = 0;
for (const r of crawled.slice(0, 12)) {
  const actual = Number.parseInt(r.trong_db, 10);
  missing += Math.max(0, r.nguon_bao - actual);
  const flag = actual < r.nguon_bao ? ' ⚠️' : '';
  console.log(
    `  ${String(r.nguon_bao).padStart(9)} │ ${String(actual).padStart(8)} │ ${r.title.slice(0, 34)}${flag}`,
  );
}
console.log(`\n  Tổng số chương CÒN THIẾU: ${missing}`);

console.log(`\nDỮ LIỆU SEED còn sót (${seeded.length} novel)`);
for (const r of seeded.slice(0, 12)) console.log(`  ${r.slug}`);

await closePool();
