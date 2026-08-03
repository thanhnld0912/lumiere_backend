import type { RunSummary } from '../result/index.js';
import type { CrawlContext } from '../types.js';

/**
 * Job: một đơn vị công việc chạy được, do CLI hoặc scheduler gọi.
 *
 * Tầng này tồn tại để CLI và GitHub Actions không phải biết gì về pipeline bên
 * trong — chúng chỉ chọn job và chạy.
 */
export interface IJob {
  readonly name: string;
  execute(ctx: CrawlContext): Promise<RunSummary>;
}
