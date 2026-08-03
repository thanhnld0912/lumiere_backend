import type { SourceConfig } from '../../config/sources/types.js';

/**
 * Normalizer: DTO thô -> DTO canonical.
 *
 * Đây là nơi diễn giải dữ liệu: '4.2 / 5 from 1,234 ratings' thành
 * `{ rating: 4.2, ratingsCount: 1234 }`, 'Completed' của nguồn thành enum
 * `novel_status` của Lumiere, tiêu đề thành slug.
 *
 * Tách khỏi parser là có chủ đích: khi nguồn đổi CÁCH VIẾT (không phải đổi HTML),
 * chỉ bảng mapping trong normalizer phải sửa, parser giữ nguyên.
 *
 * Vẫn là hàm thuần — không I/O.
 */
export interface NormalizeContext {
  readonly sourceId: string;
  readonly config: SourceConfig;
  /** Truyền vào thay vì gọi `new Date()` bên trong, để normalizer test được. */
  readonly now: Date;
}

export interface INormalizer<TRaw, TNormalized> {
  readonly name: string;
  normalize(raw: TRaw, ctx: NormalizeContext): TNormalized;
}
