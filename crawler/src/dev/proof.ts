import { closePool, query } from '../database/pool.js';

/** Bằng chứng SQL: chapters và chapter_contents có khớp nguồn không. */

const one = await query<{
  nguon_bao: number;
  chapters: number;
  chapter_contents: number;
}>(
  `SELECT n.total_chapters AS nguon_bao,
          (SELECT COUNT(*)::int FROM chapters c WHERE c.novel_id = n.id) AS chapters,
          (SELECT COUNT(*)::int FROM chapters c
             JOIN chapter_contents cc ON cc.chapter_id = c.id
            WHERE c.novel_id = n.id) AS chapter_contents
   FROM novels n WHERE n.slug = $1`,
  ['2441502-crimson-star'],
);

console.log('\n=== Crimson Star ===');
console.table(one);

const totals = await query<{
  tong_chapters: number;
  tong_contents: number;
  novel_crawl: number;
  novel_du_noi_dung: number;
}>(`
  SELECT (SELECT COUNT(*)::int FROM chapters)          AS tong_chapters,
         (SELECT COUNT(*)::int FROM chapter_contents)  AS tong_contents,
         (SELECT COUNT(*)::int FROM novels WHERE primary_source_id IS NOT NULL) AS novel_crawl,
         (SELECT COUNT(*)::int FROM novels n
           WHERE n.primary_source_id IS NOT NULL
             AND (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id) > 1) AS novel_du_noi_dung
`);

console.log('=== Toàn bộ database ===');
console.table(totals);

await closePool();
