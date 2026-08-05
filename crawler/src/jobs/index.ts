import type { CrawlMode, NovelRef } from '../core/types.js';
import { BaseJob } from './BaseJob.js';
import { DiscoverJob } from './DiscoverJob.js';
import { LatestJob } from './LatestJob.js';
import { RefreshJob } from './RefreshJob.js';

export { BaseJob, type JobContext, type JobResult } from './BaseJob.js';
export { DiscoverJob } from './DiscoverJob.js';
export { LatestJob } from './LatestJob.js';
export { RefreshJob } from './RefreshJob.js';

/** Chọn job theo mode. Thêm mode mới chỉ cần thêm một nhánh ở đây. */
export function createJob(mode: CrawlMode, targets?: readonly NovelRef[]): BaseJob {
  switch (mode) {
    case 'discover':
      return new DiscoverJob();
    case 'latest':
      return new LatestJob();
    case 'refresh':
      return new RefreshJob(targets);
  }
}
