import { slugify } from '../utils/slugify.js';
import { BaseRepository } from './BaseRepository.js';

/**
 * Bảng `genres`/`novel_genres` và `tags`/`novel_tags`.
 *
 * Gộp hai nhóm vào một repository vì chúng có cấu trúc giống hệt nhau; tách ra
 * sẽ là hai file copy-paste của nhau. Nhưng dữ liệu thì TÁCH BẠCH: NovelUpdates
 * có ~50 genre nhưng hàng nghìn tag, trộn chung sẽ làm hỏng bộ lọc genre của
 * DiscoverView.
 */
export class TaxonomyRepository extends BaseRepository {
  /**
   * Đảm bảo các genre tồn tại, trả về map name -> id.
   *
   * Dùng `unnest` để chèn cả lô trong MỘT câu lệnh thay vì N câu — với novel có
   * 40 tag thì khác biệt là 1 round-trip so với 40.
   */
  async ensureGenres(names: readonly string[]): Promise<Map<string, string>> {
    return this.ensureTerms('genres', names, 60);
  }

  async ensureTags(names: readonly string[]): Promise<Map<string, string>> {
    return this.ensureTerms('tags', names, 80);
  }

  async replaceNovelGenres(novelId: string, genreIds: readonly string[]): Promise<void> {
    await this.replaceLinks('novel_genres', 'genre_id', novelId, genreIds, true);
  }

  async replaceNovelTags(novelId: string, tagIds: readonly string[]): Promise<void> {
    await this.replaceLinks('novel_tags', 'tag_id', novelId, tagIds, false);
  }

  private async ensureTerms(
    table: 'genres' | 'tags',
    names: readonly string[],
    maxSlugLength: number,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (names.length === 0) return result;

    /*
     * Khử trùng lặp TRƯỚC khi gửi đi.
     *
     * `INSERT ... ON CONFLICT DO UPDATE` sẽ lỗi "cannot affect row a second time"
     * nếu cùng một khoá xuất hiện hai lần trong một câu lệnh. Nguồn hoàn toàn có
     * thể trả 'Action' hai lần.
     */
    const bySlug = new Map<string, string>();
    for (const name of names) {
      const slug = slugify(name, { maxLength: maxSlugLength });
      if (!bySlug.has(slug)) bySlug.set(slug, name);
    }

    const slugs = [...bySlug.keys()];
    const displayNames = [...bySlug.values()];

    const rows = await this.many<{ id: string; name: string }>(
      `INSERT INTO ${table} (slug, name)
       SELECT * FROM unnest($1::text[], $2::text[])
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name`,
      [slugs, displayNames],
    );

    for (const row of rows) result.set(row.name, row.id);
    return result;
  }

  /**
   * Thay toàn bộ liên kết. Xoá-rồi-chèn vì nguồn có thể BỎ một genre/tag, và
   * upsert thuần sẽ để lại liên kết cũ vĩnh viễn.
   *
   * `withPosition`: chỉ `novel_genres` có cột này — thứ tự genre có ý nghĩa hiển
   * thị, HomeView render `genres[0]` làm badge.
   */
  private async replaceLinks(
    table: 'novel_genres' | 'novel_tags',
    column: 'genre_id' | 'tag_id',
    novelId: string,
    ids: readonly string[],
    withPosition: boolean,
  ): Promise<void> {
    await this.execute(`DELETE FROM ${table} WHERE novel_id = $1`, [novelId]);
    if (ids.length === 0) return;

    if (withPosition) {
      await this.execute(
        `INSERT INTO ${table} (novel_id, ${column}, position)
         SELECT $1, term_id::uuid, (ordinality - 1)::smallint
         FROM unnest($2::uuid[]) WITH ORDINALITY AS t(term_id, ordinality)
         ON CONFLICT DO NOTHING`,
        [novelId, [...ids]],
      );
      return;
    }

    await this.execute(
      `INSERT INTO ${table} (novel_id, ${column})
       SELECT $1, term_id::uuid FROM unnest($2::uuid[]) AS t(term_id)
       ON CONFLICT DO NOTHING`,
      [novelId, [...ids]],
    );
  }
}
