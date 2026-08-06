import type { PoolClient } from 'pg';
import type { ImportContext } from '../core/contracts/IImporter.js';
import type { ItemOutcome } from '../core/result/index.js';
import { withRetryableTransaction } from '../database/transaction.js';
import type { NormalizedChapterRef, NormalizedNovel } from '../dto/index.js';
import {
  ChapterRepository,
  NovelRepository,
  SourceRepository,
  SyncRepository,
  TaxonomyRepository,
  TranslationGroupRepository,
} from '../repositories/index.js';
import { logger } from '../utils/logger.js';
import { profiler } from '../utils/profiler.js';

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
      return await profiler.time('refresh:db-write', () =>
        withRetryableTransaction(
          (client) => this.runInTransaction(client, novel, ctx, base),
          `import:${novel.externalId}`,
        ),
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
      if (ctx.dryRun) return { ...base, action: 'unchanged' };

      /*
       * ⚠️ Metadata không đổi KHÔNG có nghĩa là không có gì để ghi.
       *
       * `content_hash` chỉ chứng minh METADATA của nguồn không đổi. Nó KHÔNG
       * chứng minh những gì ta đã lưu là đầy đủ. Hai thứ đó lệch nhau mỗi khi
       * crawler học được cách lấy thêm dữ liệu:
       *
       *   - thêm `fetchAllChapters` -> nguồn vẫn báo 200 chương như cũ nên hash
       *     trùng, và mục lục MÃI MÃI dừng ở 1 dòng
       *   - thêm `fetchChapterContents` -> hash vẫn trùng, và `chapter_contents`
       *     MÃI MÃI rỗng
       *
       * Đó chính xác là thứ đã xảy ra: mọi bản sửa ở đường ghi đều bị chặn ngay
       * tại dòng `return unchanged` này, và chỉ `--force` mới vượt qua được.
       *
       * Nên trước khi thoát phải ĐỐI CHIẾU với những gì đang lưu và bù phần
       * thiếu. Vẫn không đụng tới bảng `novels`, nên `updated_at` không nhảy và
       * Timeline không có sự kiện rác.
       */
      const repair = await this.reconcile(chapters, existingLink.novelId, novel);
      await sources.touchCrawledAt(ctx.sourceUuid, novel.externalId, novel.crawledAt);

      return {
        ...base,
        action: 'unchanged',
        contentsWritten: repair.contentsWritten,
        contentsFetched: countFetched(novel),
      };
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
    const { chaptersAdded, contentsWritten } = await this.syncLatestChapter(
      chapters,
      novelId,
      novel,
    );

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
      contentsWritten,
      contentsFetched: countFetched(novel),
    };
  }

  /**
   * Bù phần THIẾU cho novel mà metadata không đổi — bước tự chữa.
   *
   * Hai việc, theo đúng thứ tự:
   *   1. mục lục trong DB ít hơn nguồn -> ghi bổ sung các chương còn thiếu
   *   2. nội dung vừa tải về -> ghi vào `chapter_contents`
   *
   * Bước 1 chỉ chạy khi thực sự lệch. Một COUNT rẻ hơn nhiều so với việc UPSERT
   * lại hàng trăm chương ở mỗi lần refresh chỉ để phát hiện không có gì đổi.
   */
  private async reconcile(
    chapters: ChapterRepository,
    novelId: string,
    novel: NormalizedNovel,
  ): Promise<{ chaptersRepaired: number; contentsWritten: number }> {
    if (novel.chapters.length === 0) return { chaptersRepaired: 0, contentsWritten: 0 };

    const stored = await chapters.countByNovel(novelId);

    /* ── 1. Mục lục thiếu -> ghi lại toàn bộ (upsert nên idempotent) ── */
    if (novel.chapters.length > stored) {
      logger.warn(
        { externalId: novel.externalId, trongDb: stored, oNguon: novel.chapters.length },
        '[4/5] mục lục trong DB ít hơn nguồn — ghi bù, dù metadata không đổi',
      );

      const result = await this.writeChapters(chapters, novelId, novel.chapters);
      return { chaptersRepaired: novel.chapters.length - stored, ...result };
    }

    /* ── 2. Mục lục đủ -> chỉ ghi nội dung, không đụng bảng chapters ── */
    const withContent = novel.chapters.filter((chapter) => chapter.content !== undefined);
    if (withContent.length === 0) return { chaptersRepaired: 0, contentsWritten: 0 };

    const ids = await chapters.findIdsBySlug(
      novelId,
      withContent.map((chapter) => chapter.slug),
    );

    let contentsWritten = 0;
    for (const chapter of withContent) {
      const chapterId = ids.get(chapter.slug);
      if (chapterId === undefined) continue;
      if (await chapters.upsertContent(chapterId, chapter.content ?? [])) contentsWritten += 1;
    }

    logger.info(
      { externalId: novel.externalId, contentsWritten },
      '[5/5] đã ghi chapter_contents (metadata không đổi)',
    );
    return { chaptersRepaired: 0, contentsWritten };
  }

  /**
   * Ghi một danh sách chương kèm nội dung. Dùng chung cho đường import bình
   * thường và đường tự chữa, để hai đường không bao giờ lệch hành vi.
   */
  private async writeChapters(
    chapters: ChapterRepository,
    novelId: string,
    list: readonly NormalizedChapterRef[],
  ): Promise<{ contentsWritten: number }> {
    let contentsWritten = 0;

    for (const chapter of list) {
      const { id: chapterId } = await chapters.upsert(novelId, chapter);

      /*
       * Ghi nội dung NGAY sau khi có chapterId.
       *
       * `content === undefined` nghĩa là adapter chưa lấy nội dung chương này
       * (chưa tới lượt trong ngân sách). Bỏ qua — KHÔNG được ghi mảng rỗng đè
       * lên nội dung đã lưu, vì như vậy một lượt crawl không kèm nội dung sẽ
       * xoá trắng chương đang đọc được.
       */
      if (chapter.content !== undefined) {
        if (await chapters.upsertContent(chapterId, chapter.content)) contentsWritten += 1;
      }
    }

    return { contentsWritten };
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
  ): Promise<{ chaptersAdded: number; contentsWritten: number }> {
    const latest = novel.latestChapter;
    if (latest === null) return { chaptersAdded: 0, contentsWritten: 0 };

    const previousMax = await chapters.findMaxNumber(novelId);

    /*
     * Nguồn cho ĐỦ mục lục -> ghi hết. Không có thì chỉ ghi chương mới nhất.
     *
     * Mảng rỗng nghĩa là "nguồn không cung cấp danh sách", KHÁC với "novel không
     * có chương nào" — nên không được xoá danh sách đang có. Nhờ vậy một lượt
     * `latest` (vốn chỉ biết chương mới nhất) không xoá mất mục lục mà `refresh`
     * đã dựng đầy đủ.
     */
    const { contentsWritten } = await this.writeChapters(
      chapters,
      novelId,
      novel.chapters.length > 0 ? novel.chapters : [latest],
    );

    logger.info(
      {
        externalId: novel.externalId,
        chaptersSaved: novel.chapters.length > 0 ? novel.chapters.length : 1,
        contentsWritten,
      },
      '[4/5][5/5] đã lưu metadata chương và ghi chapter_contents',
    );

    /*
     * ⚠️ CỐ Ý KHÔNG gọi `syncTotalChapters` ở đây.
     *
     * Hàm đó đặt total_chapters = COUNT(*) của bảng chapters. Con số của NGUỒN
     * mới là chuẩn: nguồn nào không cho mục lục (như NovelUpdates) thì ta chỉ có
     * một dòng, và COUNT(*) sẽ ghi đè 22 thành 1 — NovelDetailView hiển thị
     * "1 Chapters" cho một truyện 22 chương.
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
    if (previousMax === 0) return { chaptersAdded: 0, contentsWritten };

    return { chaptersAdded: Math.max(0, latest.number - previousMax), contentsWritten };
  }
}

/**
 * Số chương mà adapter tải được text về, kể cả chương rỗng.
 *
 * `content === undefined` = chưa tới lượt tải. Đếm phần KHÁC undefined cho biết
 * adapter đã làm việc hay chưa — thứ phân biệt "đã đủ nội dung nên không cần
 * tải lại" với "đường ghi hỏng".
 */
function countFetched(novel: NormalizedNovel): number {
  return novel.chapters.filter((chapter) => chapter.content !== undefined).length;
}
