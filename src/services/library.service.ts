import { query, queryOne } from '../config/database';
import type { NovelDto } from '../models';
import { ApiError } from '../utils/ApiError';
import { listNovelsBySlugs, resolveNovelId } from './novel.service';

export interface BookmarkResult {
  novelId: string;
  isBookmarked: boolean;
}

/**
 * POST /api/novels/:slug/bookmark
 *
 * Dùng POST/DELETE riêng thay vì một endpoint "toggle" duy nhất: toggle không
 * idempotent, nên khi mạng chập chờn và client retry, trạng thái sẽ bị lật
 * ngược lại — đúng cái bug mà App.tsx:85-92 sẽ gặp nếu port thẳng lên HTTP.
 */
export async function addBookmark(novelSlug: string, userId: string): Promise<BookmarkResult> {
  const novelId = await resolveNovelId(novelSlug);

  await query(
    `
    INSERT INTO bookmarks (user_id, novel_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, novel_id) DO NOTHING
    `,
    [userId, novelId],
  );

  return { novelId: novelSlug, isBookmarked: true };
}

/** DELETE /api/novels/:slug/bookmark */
export async function removeBookmark(novelSlug: string, userId: string): Promise<BookmarkResult> {
  const novelId = await resolveNovelId(novelSlug);

  await query('DELETE FROM bookmarks WHERE user_id = $1 AND novel_id = $2', [userId, novelId]);

  return { novelId: novelSlug, isBookmarked: false };
}

/**
 * GET /api/library/bookmarks
 * Nguồn: ProfileView.tsx:18 `novels.filter(n => n.isBookmarked)`
 */
export async function getBookmarks(userId: string): Promise<NovelDto[]> {
  const rows = await query<{ slug: string }>(
    `
    SELECT n.slug
    FROM bookmarks b
    JOIN novels n ON n.id = b.novel_id
    WHERE b.user_id = $1
    ORDER BY b.created_at DESC
    `,
    [userId],
  );

  return listNovelsBySlugs(
    rows.map((row) => row.slug),
    userId,
  );
}

/**
 * GET /api/library/history
 * Nguồn: ProfileView.tsx:19 và HomeView.tsx:21 — cả hai đều là
 * `novels.filter(n => n.lastReadChapterId)`, tức mọi novel đã bắt đầu đọc.
 */
export async function getHistory(userId: string): Promise<NovelDto[]> {
  const rows = await query<{ slug: string }>(
    `
    SELECT n.slug
    FROM reading_progress rp
    JOIN novels n ON n.id = rp.novel_id
    WHERE rp.user_id = $1 AND rp.last_chapter_id IS NOT NULL
    ORDER BY rp.updated_at DESC
    `,
    [userId],
  );

  return listNovelsBySlugs(
    rows.map((row) => row.slug),
    userId,
  );
}

export interface FollowResult {
  groupSlug: string;
  isFollowed: boolean;
}

/** POST /api/translation-groups/:slug/follow — NovelDetailView.tsx:283 */
export async function followGroup(groupSlug: string, userId: string): Promise<FollowResult> {
  const groupId = await resolveGroupId(groupSlug);

  await query(
    `
    INSERT INTO group_follows (user_id, group_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, group_id) DO NOTHING
    `,
    [userId, groupId],
  );

  return { groupSlug, isFollowed: true };
}

/** DELETE /api/translation-groups/:slug/follow */
export async function unfollowGroup(groupSlug: string, userId: string): Promise<FollowResult> {
  const groupId = await resolveGroupId(groupSlug);

  await query('DELETE FROM group_follows WHERE user_id = $1 AND group_id = $2', [userId, groupId]);

  return { groupSlug, isFollowed: false };
}

async function resolveGroupId(slug: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    'SELECT id FROM translation_groups WHERE slug = $1',
    [slug],
  );
  if (!row) {
    throw ApiError.notFound('Translation group not found');
  }
  return row.id;
}