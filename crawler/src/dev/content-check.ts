import { closePool, query } from '../database/pool.js';

/**
 * Đối chiếu 3 con số cho một novel: nguồn báo / chương trong DB / chương có nội dung.
 *
 *   npx tsx src/dev/content-check.ts crimson
 */
const filter = process.argv[2] ?? '';

const rows = await query<{
  slug: string;
  title: string;
  nguon_bao: number;
  chapters: string;
  co_noi_dung: string;
  tong_doan: string;
}>(
  `SELECT n.slug, n.title,
          n.total_chapters AS nguon_bao,
          (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id)::text AS chapters,
          (SELECT COUNT(*) FROM chapters c
             JOIN chapter_contents cc ON cc.chapter_id = c.id
            WHERE c.novel_id = n.id)::text AS co_noi_dung,
          (SELECT COALESCE(SUM(array_length(cc.paragraphs, 1)), 0) FROM chapters c
             JOIN chapter_contents cc ON cc.chapter_id = c.id
            WHERE c.novel_id = n.id)::text AS tong_doan
   FROM novels n
   WHERE n.primary_source_id IS NOT NULL AND ($1 = '' OR n.slug ILIKE '%' || $1 || '%')
   ORDER BY (SELECT COUNT(*) FROM chapters c
               JOIN chapter_contents cc ON cc.chapter_id = c.id
              WHERE c.novel_id = n.id) DESC
   LIMIT 12`,
  [filter],
);

console.log('\n  nguồn │ chapters │ có nội dung │ tổng đoạn │ novel');
console.log('  ──────┼──────────┼─────────────┼───────────┼────────────────');
for (const row of rows) {
  const complete = row.chapters === row.co_noi_dung && row.co_noi_dung !== '0';
  console.log(
    `  ${String(row.nguon_bao).padStart(5)} │ ${row.chapters.padStart(8)} │ ` +
      `${row.co_noi_dung.padStart(11)} │ ${row.tong_doan.padStart(9)} │ ` +
      `${row.title.slice(0, 30)} ${complete ? '✅' : ''}`,
  );
}

const sample = await query<{ number: number; title: string; doan: string; dau: string }>(
  `SELECT c.number, c.title,
          array_length(cc.paragraphs, 1)::text AS doan,
          left(cc.paragraphs[1], 70) AS dau
   FROM chapters c
   JOIN chapter_contents cc ON cc.chapter_id = c.id
   JOIN novels n ON n.id = c.novel_id
   WHERE $1 = '' OR n.slug ILIKE '%' || $1 || '%'
   ORDER BY c.sort_index
   LIMIT 5`,
  [filter],
);

if (sample.length > 0) {
  console.log('\n  Mẫu nội dung thật đã lưu:');
  for (const row of sample) {
    console.log(`   ch.${row.number} "${row.title}" — ${row.doan} đoạn`);
    console.log(`      "${row.dau}…"`);
  }
}

await closePool();
