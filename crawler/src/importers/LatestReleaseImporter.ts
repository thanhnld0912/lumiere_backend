import type { ImportContext } from '../core/contracts/IImporter.js';
import type { ItemOutcome } from '../core/result/index.js';
import type { NormalizedLatestRelease } from '../dto/index.js';
import { withTransaction } from '../database/transaction.js';
import {
  ChapterRepository,
  SourceRepository,
  SyncRepository,
} from '../repositories/index.js';

export interface LatestImportResult {
  readonly outcome: ItemOutcome;
  /**
   * Novel chưa có trong database -> cần một lượt `refresh` để lấy metadata.
   * LatestJob gom các mục này lại và đưa sang RefreshJob.
   */
  readonly needsRefresh: boolean;
}

/**
 * Ghi kết quả của mode `latest`.
 *
 * ⚠️ CỐ Ý KHÔNG cập nhật metadata novel (tiêu đề, genre, rating, status…).
 *
 * Feed "latest releases" chỉ cho biết CHƯƠNG NÀO vừa ra. Nó không có mô tả,
 * không có tags, không có rating. Nạp nó vào bảng `novels` sẽ ghi đè dữ liệu đầy
 * đủ mà `refresh` đã lấy về bằng một bản ghi thiếu thốn. Cập nhật metadata là
 * việc của `RefreshJob`.
 *
 * Ở đây chỉ làm ba việc:
 *   1. ghi dòng chương mới (cần cho bước 2 có ý nghĩa và để idempotent)
 *   2. ghi `sync_events` — feed cho GET /api/timeline
 *   3. báo cho job biết novel nào chưa tồn tại, để enqueue refresh
 *
 * Tách khỏi `NovelImporter` thay vì thêm cờ vào nó: hai đường ghi này có ngữ
 * nghĩa khác hẳn nhau, và một hàm import với cờ "đừng ghi metadata" là chỗ rất
 * dễ gọi nhầm.
 */
export class LatestReleaseImporter {
  async import(
    release: NormalizedLatestRelease,
    ctx: ImportContext,
  ): Promise<LatestImportResult> {
    const base = { externalId: release.externalId, sourceUrl: release.sourceUrl };

    // dry-run: kiểm tra mọi thứ nhưng không ghi.
    if (ctx.dryRun) {
      return {
        outcome: { ...base, action: 'skipped', reason: 'dry-run' },
        needsRefresh: false,
      };
    }

    return withTransaction(async (client) => {
      const sources = new SourceRepository(client);
      const link = await sources.findLink(ctx.sourceUuid, release.externalId);

      if (link === null) {
        /*
         * Chưa từng thấy novel này. KHÔNG tạo bản ghi ở đây — sẽ ra một novel
         * chỉ có tiêu đề, không genre, không mô tả. Đánh dấu để RefreshJob lấy
         * đầy đủ metadata.
         */
        return {
          outcome: {
            ...base,
            action: 'skipped' as const,
            reason: 'novel chưa có trong DB — đưa vào hàng đợi refresh',
          },
          needsRefresh: true,
        };
      }

      const chapter = release.chapter;
      if (chapter === null) {
        return {
          outcome: { ...base, action: 'unchanged' as const, reason: 'feed không có chương' },
          needsRefresh: false,
        };
      }

      const chapters = new ChapterRepository(client);
      const previousMax = await chapters.findMaxNumber(link.novelId);

      /*
       * ĐIỂM MẤU CHỐT CỦA TÍNH IDEMPOTENT.
       *
       * Chạy lại `latest` sau 5 phút sẽ thấy đúng những chương đó. Nếu không so
       * với số chương đang có, mỗi lần chạy sẽ đẻ thêm một sync_event và Timeline
       * của người dùng sẽ đầy sự kiện trùng lặp.
       */
      if (chapter.number <= previousMax) {
        return {
          outcome: {
            ...base,
            action: 'unchanged' as const,
            chaptersAdded: 0,
            reason: `chương ${chapter.number} đã có (cao nhất: ${previousMax})`,
          },
          needsRefresh: false,
        };
      }

      await chapters.upsert(link.novelId, chapter);

      const chaptersAdded = chapter.number - previousMax;

      await new SyncRepository(client).recordEvent({
        novelId: link.novelId,
        sourceId: ctx.sourceUuid,
        // Feed không cho biết nhóm dịch dưới dạng id; refresh sẽ điền sau.
        translationGroupId: null,
        chaptersAdded,
        occurredAt: chapter.publishedAt ?? ctx.startedAt,
      });

      return {
        outcome: {
          ...base,
          action: 'updated' as const,
          // ItemOutcome.slug là optional; nguồn không cho slug thì bỏ hẳn field
          // thay vì gán null.
          ...(release.novelSlug === null ? {} : { slug: release.novelSlug }),
          chaptersAdded,
        },
        needsRefresh: false,
      };
    });
  }
}
