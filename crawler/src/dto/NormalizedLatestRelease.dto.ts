import type { SourceId } from '../core/types.js';
import type { NormalizedChapterRef } from './NormalizedChapterRef.dto.js';

/**
 * Một chương mới phát hành, đã chuẩn hoá — đầu ra của mode `latest`.
 *
 * Khác `RawLatestRelease` ở chỗ mọi thứ đã đúng kiểu và đúng vựng từ Lumiere.
 */
export interface NormalizedLatestRelease {
  readonly sourceId: SourceId;
  readonly externalId: string;
  readonly sourceUrl: string;

  readonly novelTitle: string | null;
  readonly novelSlug: string | null;

  /** Null khi không bóc được số chương từ nhãn nguồn cho. */
  readonly chapter: NormalizedChapterRef | null;

  readonly translationGroupName: string | null;
  readonly translationGroupSlug: string | null;

  readonly crawledAt: Date;
}
