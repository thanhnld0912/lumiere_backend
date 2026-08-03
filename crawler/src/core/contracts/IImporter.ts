import type { ItemOutcome } from '../result/index.js';
import type { CrawlContext } from '../types.js';

/**
 * Importer: DTO canonical -> database, thông qua repositories.
 *
 * Ràng buộc: **importer KHÔNG được viết SQL.** Nó chỉ điều phối các repository
 * trong một transaction. SQL chỉ tồn tại ở tầng repositories.
 *
 * Mỗi novel là MỘT transaction — một novel hỏng không được kéo theo cả lô.
 */
export interface ImportContext extends CrawlContext {
  /** uuid của nguồn ở bảng `sources`, tra sẵn một lần cho cả run. */
  readonly sourceUuid: string;
}

export interface IImporter<TNormalized> {
  readonly name: string;

  /**
   * `dryRun` trong ctx phải được tôn trọng: chạy hết logic so sánh và trả
   * outcome đúng, nhưng KHÔNG ghi gì cả. Nếu không, `--dry-run` sẽ vô dụng.
   */
  import(input: TNormalized, ctx: ImportContext): Promise<ItemOutcome>;
}
