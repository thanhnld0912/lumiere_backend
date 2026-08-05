import { BaseRepository } from './BaseRepository.js';

export interface NovelSourceLink {
  readonly novelId: string;
  readonly contentHash: string | null;
  readonly lastCrawledAt: Date | null;
}

/**
 * Bảng `sources` và `novel_sources`.
 *
 * `novel_sources` là TRÁI TIM của dedup và update detection — nó trả lời ba câu
 * hỏi mà crawler hỏi liên tục:
 *   "novel này đã crawl chưa?"        -> (source_id, external_id)
 *   "dữ liệu có gì đổi không?"        -> content_hash
 *   "novel nào cũ nhất, cần refresh?" -> last_crawled_at
 */
export class SourceRepository extends BaseRepository {
  /** uuid của nguồn từ slug. Tra một lần cho cả run rồi truyền xuống. */
  async findSourceId(slug: string): Promise<string | null> {
    const row = await this.one<{ id: string }>('SELECT id FROM sources WHERE slug = $1', [slug]);
    return row?.id ?? null;
  }

  /**
   * Đăng ký nguồn từ config nếu chưa có, trả về uuid.
   *
   * Vì sao tự động thay vì bắt viết migration cho mỗi nguồn: mục tiêu là thêm
   * nguồn mới chỉ cần MỘT file config + MỘT adapter. Bắt kèm một migration nữa
   * là ma sát thừa, và là chỗ dễ quên nhất — lỗi sẽ chỉ lộ ra khi job cron chạy
   * lúc nửa đêm.
   *
   * Idempotent, nên gọi ở đầu mỗi lần chạy là an toàn.
   */
  async ensureSource(input: {
    slug: string;
    name: string;
    baseUrl: string;
    enabled: boolean;
  }): Promise<string> {
    const row = await this.one<{ id: string }>(
      `INSERT INTO sources (slug, name, base_url, is_enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name, base_url = EXCLUDED.base_url
       RETURNING id`,
      [input.slug, input.name, input.baseUrl, input.enabled],
    );

    if (!row) throw new Error(`Không đăng ký được nguồn '${input.slug}'`);
    return row.id;
  }

  /**
   * Tra novel đã liên kết với nguồn này chưa.
   *
   * Đây là bước dedup ĐÁNG TIN CẬY NHẤT: cặp (nguồn, id bên nguồn) là danh tính
   * chắc chắn, không phụ thuộc vào tiêu đề hay slug có thể thay đổi.
   */
  async findLink(sourceId: string, externalId: string): Promise<NovelSourceLink | null> {
    const row = await this.one<{
      novel_id: string;
      content_hash: string | null;
      last_crawled_at: Date | null;
    }>(
      `SELECT novel_id, content_hash, last_crawled_at
       FROM novel_sources
       WHERE source_id = $1 AND external_id = $2`,
      [sourceId, externalId],
    );

    if (!row) return null;
    return {
      novelId: row.novel_id,
      contentHash: row.content_hash,
      lastCrawledAt: row.last_crawled_at,
    };
  }

  async upsertLink(input: {
    novelId: string;
    sourceId: string;
    externalId: string;
    sourceUrl: string;
    contentHash: string;
    crawledAt: Date;
    changed: boolean;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO novel_sources
         (novel_id, source_id, external_id, source_url, content_hash, last_crawled_at, last_changed_at)
       /*
        * Ép kiểu tường minh cho $6 và $7 là BẮT BUỘC.
        *
        * $6 xuất hiện vừa ở vị trí cột timestamptz vừa trong nhánh CASE, nên
        * Postgres không suy được một kiểu duy nhất và báo
        * "inconsistent types deduced for parameter $6".
        */
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz,
               CASE WHEN $7::boolean THEN $6::timestamptz ELSE NULL END)
       ON CONFLICT (source_id, external_id) DO UPDATE
         SET source_url      = EXCLUDED.source_url,
             content_hash    = EXCLUDED.content_hash,
             last_crawled_at = EXCLUDED.last_crawled_at,
             -- Chỉ dời last_changed_at khi nội dung THỰC SỰ đổi.
             last_changed_at = CASE
               WHEN $7::boolean THEN EXCLUDED.last_crawled_at
               ELSE novel_sources.last_changed_at
             END`,
      [
        input.novelId,
        input.sourceId,
        input.externalId,
        input.sourceUrl,
        input.contentHash,
        input.crawledAt,
        input.changed,
      ],
    );
  }

  /**
   * Nội dung không đổi -> chỉ chạm `last_crawled_at`.
   *
   * Đây là đường đi PHỔ BIẾN NHẤT ở mode refresh. Nhờ nó mà một lần chạy hàng
   * nghìn novel chỉ tốn một câu UPDATE nhỏ cho mỗi novel, thay vì viết lại toàn
   * bộ bảng `novels` và làm `updated_at` nhảy loạn.
   */
  async touchCrawledAt(sourceId: string, externalId: string, crawledAt: Date): Promise<void> {
    await this.execute(
      `UPDATE novel_sources SET last_crawled_at = $3
       WHERE source_id = $1 AND external_id = $2`,
      [sourceId, externalId, crawledAt],
    );
  }

  /**
   * Novel cũ nhất cần refresh — nguồn cho RunPlanner (Phase 9).
   * NULLS FIRST: chưa crawl bao giờ thì ưu tiên cao nhất.
   */
  async findStale(
    sourceId: string,
    limit: number,
  ): Promise<{ externalId: string; sourceUrl: string }[]> {
    const rows = await this.many<{ external_id: string; source_url: string }>(
      `SELECT external_id, source_url
       FROM novel_sources
       WHERE source_id = $1
       ORDER BY last_crawled_at ASC NULLS FIRST
       LIMIT $2`,
      [sourceId, limit],
    );
    return rows.map((row) => ({ externalId: row.external_id, sourceUrl: row.source_url }));
  }
}
