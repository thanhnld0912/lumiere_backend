import type { NovelStatus } from '../core/types.js';

/**
 * Hình dạng dòng THÔ trả về từ PostgreSQL (snake_case).
 *
 * Lưu ý về kiểu: `pg` trả `numeric` và `bigint` về dưới dạng **string** để
 * không mất chính xác với số lớn. Các field đó được khai báo `string` ở đây cho
 * đúng sự thật — repository là nơi chịu trách nhiệm chuyển đổi.
 */

export interface SourceRow {
  id: string;
  slug: string;
  name: string;
  base_url: string;
  is_enabled: boolean;
}

export interface NovelSourceRow {
  novel_id: string;
  source_id: string;
  external_id: string;
  source_url: string;
  content_hash: string | null;
  last_crawled_at: Date | null;
  last_changed_at: Date | null;
}

export interface NovelRow {
  id: string;
  slug: string;
  title: string;
  author: string;
  status: NovelStatus;
  total_chapters: number;
  /** numeric(3,2) -> string */
  rating: string;
  ratings_count: number;
  language: string | null;
  last_synced_at: Date | null;
  last_chapter_at: Date | null;
}

export interface ChapterRow {
  id: string;
  novel_id: string;
  slug: string;
  number: number;
  title: string;
  volume_number: number | null;
  part_number: number | null;
  is_extra: boolean;
  /** bigint -> string (giá trị vượt Number.MAX_SAFE_INTEGER ở dải volume cao) */
  sort_index: string | null;
  published_at: Date;
}

export interface TranslationGroupRow {
  id: string;
  slug: string;
  name: string;
}

export interface GenreRow {
  id: string;
  slug: string;
  name: string;
}

export interface TagRow {
  id: string;
  slug: string;
  name: string;
}

/** Một mục việc do RunPlanner chọn: novel cũ nhất cần refresh. */
export interface StaleNovelRow {
  novel_id: string;
  external_id: string;
  source_url: string;
  content_hash: string | null;
  last_crawled_at: Date | null;
}
