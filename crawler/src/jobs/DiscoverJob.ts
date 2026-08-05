import { canDiscover } from '../core/contracts/ISourceAdapter.js';
import { ConfigError } from '../core/errors/index.js';
import type { ItemOutcome } from '../core/result/index.js';
import type { CrawlMode, NovelRef } from '../core/types.js';
import { BaseJob, type JobContext, type JobResult } from './BaseJob.js';

/**
 * Mode `discover` — duyệt danh mục tìm novel MỚI.
 *
 * Job này KHÔNG ghi gì vào database. Trang danh mục chỉ có tiêu đề và ảnh bìa;
 * tạo bản ghi từ đó sẽ ra novel không genre, không mô tả, không rating.
 *
 * Việc của nó là trả về danh sách con trỏ để RefreshJob nạp đầy đủ — chính là
 * "enqueue refresh" mà đề bài yêu cầu.
 *
 * Idempotent một cách hiển nhiên: không ghi gì thì chạy bao nhiêu lần cũng vậy.
 * Bước refresh phía sau thì idempotent nhờ `content_hash`.
 */
export class DiscoverJob extends BaseJob {
  readonly name = 'discover';
  readonly mode: CrawlMode = 'discover';

  async execute(ctx: JobContext): Promise<JobResult> {
    const log = this.logger(ctx);

    if (!canDiscover(ctx.adapter)) {
      throw new ConfigError(`Nguồn '${ctx.sourceId}' không hỗ trợ mode discover`);
    }

    const plan = await ctx.planner.planFor(ctx, ctx.sourceUuid);
    const refs = await ctx.adapter.discover(ctx);

    log.info({ found: refs.length }, 'đã duyệt danh mục');

    /*
     * Đưa TẤT CẢ vào hàng đợi, không lọc trước những novel đã có.
     *
     * Lọc ở đây sẽ cần truy vấn database — mà job không được phép chạm tới
     * repository. Và cũng không cần: RefreshJob dùng `content_hash` nên novel đã
     * có mà không đổi sẽ ra `unchanged` với đúng một câu UPDATE nhỏ.
     */
    const outcomes: ItemOutcome[] = refs.map((ref) => ({
      action: 'skipped' as const,
      externalId: ref.externalId,
      sourceUrl: ref.sourceUrl,
      reason: 'discover chỉ liệt kê — refresh mới nạp dữ liệu',
    }));

    const refreshQueue: NovelRef[] = [...refs];

    return { outcomes, truncated: refs.length >= plan.maxItems, refreshQueue };
  }
}
