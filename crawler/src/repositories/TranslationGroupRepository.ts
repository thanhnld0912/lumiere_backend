import type { NormalizedTranslationGroup } from '../dto/index.js';
import { BaseRepository } from './BaseRepository.js';

/**
 * Bảng `translation_groups`.
 *
 * Nguồn như ScribbleHub (nền tảng đăng gốc) KHÔNG có nhóm dịch, và normalizer
 * của nó trả null — repository này sẽ không bao giờ được gọi. Đó là chủ đích:
 * nhét tên tác giả vào ô nhóm dịch sẽ làm hỏng ngữ nghĩa của bảng và khiến nút
 * Follow ở NovelDetailView hiển thị sai.
 */
export class TranslationGroupRepository extends BaseRepository {
  async ensure(group: NormalizedTranslationGroup | null): Promise<string | null> {
    if (group === null) return null;

    const row = await this.one<{ id: string }>(
      `INSERT INTO translation_groups (slug, name, site_url)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name,
             -- Không ghi đè site_url đang có bằng NULL: nguồn thỉnh thoảng
             -- không trả field này, và mất dữ liệu tốt là không chấp nhận được.
             site_url = COALESCE(EXCLUDED.site_url, translation_groups.site_url)
       RETURNING id`,
      [group.slug, group.name, group.siteUrl],
    );

    return row?.id ?? null;
  }
}
