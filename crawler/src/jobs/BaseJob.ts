import type { ISourceAdapter } from '../core/contracts/ISourceAdapter.js';
import type { ItemOutcome } from '../core/result/index.js';
import type { CrawlContext, CrawlMode, NovelRef } from '../core/types.js';
import type { RunPlanner } from '../scheduler/RunPlanner.js';
import { childLogger } from '../utils/logger.js';

/**
 * Mọi thứ một job cần để chạy.
 *
 * `sourceUuid` được tra sẵn ở tầng trên và truyền xuống — job KHÔNG tự truy vấn
 * database.
 */
export interface JobContext extends CrawlContext {
  readonly adapter: ISourceAdapter;
  /** uuid của nguồn trong bảng `sources` (khác `sourceId` vốn là slug). */
  readonly sourceUuid: string;
  readonly planner: RunPlanner;
  /** Ghi lại bất kể content_hash — dùng sau khi sửa bug ở đường ghi. */
  readonly force: boolean;
}

export interface JobResult {
  readonly outcomes: readonly ItemOutcome[];
  /** Trần bị chạm — nhiều khả năng còn việc chưa xử lý. */
  readonly truncated: boolean;
  /**
   * Novel cần một lượt `refresh` sau job này.
   *
   * `LatestJob` và `DiscoverJob` phát hiện novel chưa có trong database nhưng
   * CỐ Ý không tự nạp — chúng không có metadata đầy đủ. Danh sách này chính là
   * "hàng đợi" mà đề bài gọi là enqueue refresh.
   */
  readonly refreshQueue: readonly NovelRef[];
}

/**
 * Lớp cha cho các job.
 *
 * ⚠️ RANH GIỚI: job CHỈ điều phối. Không parse HTML, không viết SQL, không gọi
 * repository. Nó chỉ gọi Adapter (lấy dữ liệu) và Importer (ghi dữ liệu).
 *
 * Nhờ vậy CLI và GitHub Actions không phải biết gì về pipeline bên trong, và
 * thêm nguồn mới không đụng tới tầng này.
 */
export abstract class BaseJob {
  abstract readonly name: string;
  abstract readonly mode: CrawlMode;

  abstract execute(ctx: JobContext): Promise<JobResult>;

  protected logger(ctx: JobContext): ReturnType<typeof childLogger> {
    return childLogger({ job: this.name, source: ctx.sourceId, runId: ctx.runId });
  }

  protected empty(): JobResult {
    return { outcomes: [], truncated: false, refreshQueue: [] };
  }
}
