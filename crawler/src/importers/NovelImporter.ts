import type { PoolClient } from 'pg';
import type { ImportContext } from '../core/contracts/IImporter.js';
import type { ItemOutcome } from '../core/result/index.js';
import { withRetryableTransaction } from '../database/transaction.js';
import type { NormalizedNovel } from '../dto/index.js';
import {
  ChapterRepository,
  NovelRepository,
  SourceRepository,
  SyncRepository,
  TaxonomyRepository,
  TranslationGroupRepository,
} from '../repositories/index.js';
import { logger } from '../utils/logger.js';

/**
 * Ghi một `NormalizedNovel` xuống database.
 *
 * ⚠️ Importer KHÔNG viết SQL — nó chỉ điều phối repository. SQL chỉ tồn tại
 * trong `repositories/`.
 *
 * MỘT NOVEL = MỘT TRANSACTION. Không gộp cả lô vì:
 *   - một novel dữ liệu lỗi sẽ kéo ngược 49 novel khác đã ghi thành công
 *   - transaction dài giữ khoá lâu trên Supabase
 */
export class NovelImporter {
  readonly name = 'novel-importer';

  async import(novel: NormalizedNovel, ctx: ImportContext): Promise<ItemOutcome> {
    const base = {
      externalId: novel.externalId,
      sourceUrl: novel.sourceUrl,
      slug: novel.slug,
    };

    try {
      return await withRetryableTransaction(
        (client) => this.runInTransaction(client, novel, ctx, base),
        `import:${novel.externalId}`,
      );
    } catch (error) {
      logger.error(
        { externalId: novel.externalId, err: error instanceof Error ? error.message : String(error) },
        'import thất bại',
      );
      return {
        ...base,
        action: 'failed',
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  private async runInTransaction(
    client: PoolClient,
    novel: NormalizedNovel,
    ctx: ImportContext,
    base: { externalId: string; sourceUrl: string; slug: string },
  ): Promise<ItemOutcome> {
    const sources = new SourceRepository(client);
    const novels = new NovelRepository(client);
    const taxonomy = new TaxonomyRepository(client);
    const chapters = new ChapterRepository(client);
    const groups = new TranslationGroupRepository(client);
    const sync = new SyncRepository(client);

    const existingLink = await sources.findLink(ctx.sourceUuid, novel.externalId);

    /* ── 1. Không đổi gì -> thoát sớm ───────────────────────────────────────
     *
     * Đây là đường đi PHỔ BIẾN NHẤT ở mode refresh và là lý do tồn tại của
     * content_hash. Không có bước này, mỗi lần chạy sẽ UPDATE lại vài nghìn
     * dòng, đẩy `updated_at` nhảy loạn và làm `sync_events` đầy rác — Timeline
     * của người dùng sẽ mất hết ý nghĩa.
     */
    if (!ctx.force && existingLink !== null && existingLink.contentHash === novel.contentHash) {
      if (!ctx.dryRun) {
        await sources.touchCrawledAt(ctx.sourceUuid, novel.externalId, novel.crawledAt);
      }
      return { ...base, action: 'unchanged' };
    }

    /*
     * `dryRun` phải chạy HẾT logic so sánh rồi mới dừng, để `--dry-run` cho biết
     * đúng những gì sẽ xảy ra. Dừng sớm hơn thì cờ này vô dụng.
     */
    if (ctx.dryRun) {
      return { ...base, action: existingLink === null ? 'created' : 'updated' };
    }

    /* ── 2. Dedup: tìm novel đã có ─────────────────────────────────────────
     *
     * Hai bước, đều là khớp CHẮC CHẮN:
     *   (a) (source, external_id)  — danh tính bên nguồn
     *   (b) slug                   — cùng truyện, đến từ nguồn khác
     *
     * Cố ý KHÔNG khớp mờ theo tiêu đề + tác giả: hai light novel khác nhau hoàn
     * toàn có thể trùng tiêu đề tiếng Anh, và tự động gộp là cách nhanh nhất để
     * hỏng dữ liệu không hồi phục được.
     */
    let novelId = existingLink?.novelId ?? (await novels.findIdBySlug(novel.slug));
    const isNew = novelId === null;

    const translationGroupId = await groups.ensure(novel.translationGroup);

    if (novelId === null) {
      novelId = await novels.insert(novel, translationGroupId);
    } else {
      await novels.update(novelId, novel, translationGroupId);
    }

    await novels.setPrimarySourceIfEmpty(novelId, ctx.sourceUuid);

    /* ── 3. Quan hệ phụ ─────────────────────────────────────────────────── */
    await novels.replaceAltTitles(novelId, novel.altTitles);

    const genreIds = await taxonomy.ensureGenres(novel.genres);
    await taxonomy.replaceNovelGenres(
      novelId,
      // Giữ nguyên THỨ TỰ nguồn cho: HomeView render genres[0] làm badge.
      novel.genres.map((name) => genreIds.get(name)).filter((id): id is string => id !== undefined),
    );

    const tagIds = await taxonomy.ensureTags(novel.tags);
    await taxonomy.replaceNovelTags(
      novelId,
      novel.tags.map((name) => tagIds.get(name)).filter((id): id is string => id !== undefined),
    );

    /* ── 4. Chương mới nhất + đếm chương mới ───────────────────────────── */
    const chaptersAdded = await this.syncLatestChapter(chapters, novelId, novel);

    /* ── 5. Sự kiện cho Timeline ───────────────────────────────────────── */
    if (chaptersAdded > 0) {
      await sync.recordEvent({
        novelId,
        sourceId: ctx.sourceUuid,
        translationGroupId,
        chaptersAdded,
        occurredAt: novel.latestChapter?.publishedAt ?? novel.crawledAt,
      });
    }

    /* ── 6. Ghi lại hash để lần sau so sánh ────────────────────────────── */
    await sources.upsertLink({
      novelId,
      sourceId: ctx.sourceUuid,
      externalId: novel.externalId,
      sourceUrl: novel.sourceUrl,
      contentHash: novel.contentHash,
      crawledAt: novel.crawledAt,
      changed: true,
    });

    return {
      ...base,
      action: isNew ? 'created' : 'updated',
      chaptersAdded,
    };
  }

  /**
   * Ghi chương mới nhất và trả về SỐ CHƯƠNG MỚI phát hiện.
   *
   * Con số này là nguồn cho `sync_events.chapters_added_count`, tức thứ hiển thị
   * "+5 CHAPTERS" trên Timeline. Tính bằng chênh lệch số chương lớn nhất trước
   * và sau, chứ không phải đếm số dòng vừa chèn — nguồn thường chỉ cho biết
   * chương MỚI NHẤT, nên 5 chương ra cùng lúc vẫn chỉ tạo 1 dòng.
   */
  private async syncLatestChapter(
    chapters: ChapterRepository,
    novelId: string,
    novel: NormalizedNovel,
  ): Promise<number> {
    const latest = novel.latestChapter;
    if (latest === null) return 0;

    const previousMax = await chapters.findMaxNumber(novelId);
    await chapters.upsert(novelId, latest);

    /*
     * ⚠️ CỐ Ý KHÔNG gọi `syncTotalChapters` ở đây.
     *
     * Hàm đó đặt total_chapters = COUNT(*) của bảng chapters. Nhưng ta chỉ lưu
     * CHƯƠNG MỚI NHẤT, nên nó sẽ ghi đè con số đúng của nguồn (22) bằng số dòng
     * ta có (1) — làm NovelDetailView hiển thị "1 Chapters" cho một truyện 22
     * chương.
     *
     * `novels.total_chapters` đã được ghi từ `novel.totalChapters` do nguồn
     * cung cấp, và đó mới là con số đáng tin. Chỉ nên đồng bộ lại theo COUNT(*)
     * khi nào crawler thực sự lấy TOÀN BỘ danh sách chương.
     */

    /*
     * Novel mới hoàn toàn (previousMax = 0) KHÔNG tính là "vừa thêm chương":
     * nếu tính, lần discover đầu tiên sẽ đổ hàng nghìn sự kiện vào Timeline và
     * người dùng thấy toàn bộ thư viện "vừa cập nhật" cùng lúc.
     */
    if (previousMax === 0) return 0;

    return Math.max(0, latest.number - previousMax);
  }
}
