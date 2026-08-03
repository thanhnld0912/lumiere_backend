/**
 * Kiểu dữ liệu domain.
 *
 * Chia làm hai nhóm:
 *  - `*Row`  : hình dạng dòng thô trả về từ PostgreSQL (snake_case, numeric/bigint
 *              là string do pg không tự parse để tránh mất chính xác).
 *  - phần còn lại (DTO) : hình dạng JSON trả cho frontend. Các interface này
 *              PHẢI khớp 1-1 với E:\Code\Lumiere_frontend\src\types.ts.
 *
 * Ranh giới giữa hai nhóm chính là presenter layer (src/utils/presenter.ts).
 */

// ─────────────────────────────────────────────────────────────
// Enum / union
// ─────────────────────────────────────────────────────────────

/**
 * Khớp enum `novel_status` ở database và union `Novel.status` bên frontend.
 * Ba giá trị đầu là gốc; 'Dropped' và 'Unknown' thêm ở migration
 * 001_status_enum.sql để crawler map được trạng thái của NovelUpdates.
 */
export type NovelStatus = 'Ongoing' | 'Completed' | 'Hiatus' | 'Dropped' | 'Unknown';

export type UserRole = 'user' | 'admin';

// ─────────────────────────────────────────────────────────────
// DTO — PHẢI khớp frontend src/types.ts
// ─────────────────────────────────────────────────────────────

/** Khớp types.ts:1-10 (Chapter) */
export interface ChapterDto {
  id: string; // slug, VD 'ch-42' — KHÔNG phải uuid (xem F1/F2)
  number: number;
  title: string;
  date: string; // đã format, VD 'Oct 12, 2023'
  isRead: boolean;
  content?: string[];
  illustrationUrl?: string;
  wordCount?: number;
}

/**
 * Khớp types.ts:12-18 (TranslationGroup).
 *
 * `slug` là field BỔ SUNG so với frontend types.ts gốc: nút Follow
 * (NovelDetailView.tsx:283) cần một định danh để gọi
 * POST /api/translation-groups/:slug/follow, mà object gốc không có field nào
 * dùng làm khoá được (`name` có dấu cách và không đảm bảo ổn định).
 */
export interface TranslationGroupDto {
  slug: string;
  name: string;
  quality: string;
  avatarUrl: string;
  siteUrl: string;
  isFollowed?: boolean;
}

/** Khớp types.ts:20-42 (Novel) */
export interface NovelDto {
  id: string; // slug, VD 'eternal-archive'
  title: string;
  author: string;
  artist?: string;
  coverUrl: string;
  backdropUrl?: string;
  rating: number;
  ratingsCount: string; // đã format, VD '12.4k'
  status: NovelStatus;
  totalChapters: number;
  genres: string[];
  synopsis: string;
  chapters: ChapterDto[];
  translationGroup: TranslationGroupDto;
  releaseFrequency: string;
  totalViews: string; // đã format, VD '2.8M Readers'
  recommendationsCount: string; // đã format, VD '+8k'
  recommendationsAvatars: string[];
  lastReadChapterId?: string;
  lastReadProgress?: number;
  isBookmarked?: boolean;
}

/** Khớp types.ts:44-54 (TimelineItem) */
export interface TimelineItemDto {
  id: string;
  novelId: string; // slug
  novelTitle: string;
  novelCover: string;
  translator: string; // đã format, VD 'Translation by Abyss Scans'
  chaptersAddedCount: number;
  timeAgo: string; // đã format, VD '2h ago'
  month: string; // VD 'August'
  year: string; // VD '2024'
}

/** Khớp types.ts:56-63 (SyncStats) */
export interface SyncStatsDto {
  totalChapters: string; // đã format, VD '2.4k' — CHÚ Ý: string, khác Novel.totalChapters
  chaptersThisMonth: string; // đã format
  newSeriesCount: number;
  newGroupsCount: number;
  nextSyncCountdown: string; // đã format, VD '4m 12s'
  nextSyncPercentage: number;
}

/**
 * Không có tương ứng trong types.ts vì ProfileView đang hardcode thông tin user
 * trong JSX (ProfileView.tsx:31-46). Đây là hình dạng dữ liệu mà chỗ hardcode đó
 * đang thể hiện.
 */
export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
}

export interface UserStatsDto {
  chaptersRead: number;
  bookmarksCount: number;
  streakDays: number;
}

export interface AuthResponseDto {
  token: string;
  user: UserDto;
}

export interface MeResponseDto extends UserDto {
  stats: UserStatsDto;
}

// ─────────────────────────────────────────────────────────────
// Row — hình dạng thô từ PostgreSQL
// ─────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  avatar_url: string | null;
  role: UserRole;
  created_at: Date;
  updated_at: Date;
}

/**
 * Kết quả của truy vấn novel đã gộp sẵn genres/chapters/translation group.
 * `rating` là numeric và `total_views` là bigint nên pg trả về string.
 */
export interface NovelRow {
  id: string;
  slug: string;
  title: string;
  author: string;
  artist: string | null;
  cover_url: string;
  backdrop_url: string | null;
  rating: string;
  ratings_count: number;
  status: NovelStatus;
  total_chapters: number;
  synopsis: string;
  release_frequency: string | null;
  total_views: string;
  recommendations_count: number;

  group_slug: string | null;
  group_name: string | null;
  group_quality: string | null;
  group_avatar_url: string | null;
  group_site_url: string | null;
  group_is_followed: boolean | null;

  genres: string[] | null;
  recommendation_avatars: string[] | null;

  is_bookmarked: boolean | null;
  last_read_chapter_slug: string | null;
  last_read_progress: number | null;
}

export interface ChapterRow {
  id: string;
  slug: string;
  number: number;
  title: string;
  published_at: Date;
  illustration_url: string | null;
  word_count: number | null;
  is_read: boolean | null;
}

export interface ChapterContentRow extends ChapterRow {
  paragraphs: string[] | null;
}

export interface TimelineEventRow {
  id: string;
  novel_slug: string;
  novel_title: string;
  novel_cover: string;
  group_name: string | null;
  chapters_added_count: number;
  occurred_at: Date;
}