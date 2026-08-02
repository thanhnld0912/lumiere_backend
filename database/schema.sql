-- ============================================================================
-- Lumiere — PostgreSQL schema (Supabase)
--
-- Chạy bằng DIRECT connection (port 5432), KHÔNG chạy qua transaction pooler
-- (port 6543) vì pooler không xử lý DDL / advisory lock một cách tin cậy.
--
--   npm run db:schema
--
-- File này CHỈ chứa DDL + reference data (genres). Không có novel/user giả.
-- Dữ liệu mẫu nằm ở database/seed.sql (tách riêng, chạy tay).
--
-- Idempotent: chạy lại nhiều lần không lỗi.
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- email case-insensitive
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram index cho search ILIKE

-- ─────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('user', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Khớp chính xác types.ts:29 — Novel.status: 'Ongoing' | 'Completed' | 'Hiatus'
DO $$ BEGIN
  CREATE TYPE novel_status AS ENUM ('Ongoing', 'Completed', 'Hiatus');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sync_run_status AS ENUM ('running', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- Trigger dùng chung: tự cập nhật updated_at
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. users
--    Nguồn: ProfileView.tsx:26-46 (avatar, displayName, email, stats)
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext      NOT NULL,
  password_hash  text        NOT NULL,
  display_name   varchar(80) NOT NULL,
  avatar_url     text,
  role           user_role   NOT NULL DEFAULT 'user',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_email_unique       UNIQUE (email),
  CONSTRAINT users_email_format_check CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT users_display_name_check CHECK (char_length(trim(display_name)) BETWEEN 2 AND 80)
);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 2. translation_groups
--    Nguồn: types.ts:12-18 (TranslationGroup)
-- ============================================================================
CREATE TABLE IF NOT EXISTS translation_groups (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       varchar(120) NOT NULL,
  name       varchar(160) NOT NULL,
  -- Chuỗi mô tả tự do, VD 'Primary Translation Group • High Quality' (mockData.ts:19).
  -- Đây là dữ liệu nguồn thật, không phải giá trị được format ở presenter.
  quality    varchar(200),
  avatar_url text,
  site_url   text,
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT translation_groups_slug_unique UNIQUE (slug),
  CONSTRAINT translation_groups_slug_check  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

DROP TRIGGER IF EXISTS trg_translation_groups_updated_at ON translation_groups;
CREATE TRIGGER trg_translation_groups_updated_at
  BEFORE UPDATE ON translation_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 3. novels
--    Nguồn: types.ts:20-42
--
--    QUAN TRỌNG (F1): cột `slug` chính là giá trị mà API trả ra ở field `id`.
--    Frontend hardcode slug: 'shadow-of-the-void' (App.tsx:29),
--    'eternal-archive' (HomeView.tsx:18). uuid chỉ dùng nội bộ.
--
--    QUAN TRỌNG (F3/Q1): ratings_count, total_views lưu SỐ THÔ.
--    Presenter layer ở backend format thành '12.4k' / '2.8M Readers'.
-- ============================================================================
CREATE TABLE IF NOT EXISTS novels (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                 varchar(160)  NOT NULL,
  title                varchar(300)  NOT NULL,
  author               varchar(160)  NOT NULL,
  artist               varchar(160),                       -- types.ts:24, chưa render
  cover_url            text          NOT NULL,
  backdrop_url         text,
  rating               numeric(3, 2) NOT NULL DEFAULT 0,
  ratings_count        integer       NOT NULL DEFAULT 0,   -- số thô
  status               novel_status  NOT NULL DEFAULT 'Ongoing',
  total_chapters       integer       NOT NULL DEFAULT 0,
  synopsis             text          NOT NULL DEFAULT '',
  translation_group_id uuid,
  release_frequency    varchar(80),
  total_views          bigint        NOT NULL DEFAULT 0,   -- số thô
  -- Counter denormalized cho Novel.recommendationsCount (types.ts:37).
  -- Danh sách avatar thì lấy từ bảng novel_recommendations; counter để riêng vì
  -- con số thật (hàng nghìn) không tương ứng 1-1 với số dòng ta lưu.
  recommendations_count integer      NOT NULL DEFAULT 0,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT novels_slug_unique  UNIQUE (slug),
  CONSTRAINT novels_slug_check   CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT novels_rating_check CHECK (rating >= 0 AND rating <= 5),
  CONSTRAINT novels_ratings_count_check  CHECK (ratings_count >= 0),
  CONSTRAINT novels_total_chapters_check CHECK (total_chapters >= 0),
  CONSTRAINT novels_total_views_check    CHECK (total_views >= 0),
  CONSTRAINT novels_recommendations_count_check CHECK (recommendations_count >= 0),

  CONSTRAINT novels_translation_group_fk
    FOREIGN KEY (translation_group_id) REFERENCES translation_groups (id)
    ON DELETE SET NULL
);

DROP TRIGGER IF EXISTS trg_novels_updated_at ON novels;
CREATE TRIGGER trg_novels_updated_at
  BEFORE UPDATE ON novels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sort mặc định của GET /api/novels (Q2)
CREATE INDEX IF NOT EXISTS idx_novels_created_at       ON novels (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_novels_status           ON novels (status);
CREATE INDEX IF NOT EXISTS idx_novels_translation_group ON novels (translation_group_id);
-- Search ?q= trên title/author (DiscoverView.tsx:19-22, SearchModal.tsx:22-27)
CREATE INDEX IF NOT EXISTS idx_novels_title_trgm  ON novels USING gin (title  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_novels_author_trgm ON novels USING gin (author gin_trgm_ops);

-- ============================================================================
-- 4. genres  —  Nguồn: Novel.genres (types.ts:31), DiscoverView.tsx:14
-- ============================================================================
CREATE TABLE IF NOT EXISTS genres (
  id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(60) NOT NULL,
  name varchar(60) NOT NULL,

  CONSTRAINT genres_slug_unique UNIQUE (slug),
  CONSTRAINT genres_name_unique UNIQUE (name),
  CONSTRAINT genres_slug_check  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

-- ============================================================================
-- 5. novel_genres  —  N-N.
--    `position` bắt buộc: HomeView.tsx:219 render novel.genres[0] làm badge,
--    nên THỨ TỰ genre có ý nghĩa hiển thị và phải được bảo toàn.
-- ============================================================================
CREATE TABLE IF NOT EXISTS novel_genres (
  novel_id uuid     NOT NULL,
  genre_id uuid     NOT NULL,
  position smallint NOT NULL DEFAULT 0,

  CONSTRAINT novel_genres_pkey PRIMARY KEY (novel_id, genre_id),
  CONSTRAINT novel_genres_novel_fk FOREIGN KEY (novel_id) REFERENCES novels (id) ON DELETE CASCADE,
  CONSTRAINT novel_genres_genre_fk FOREIGN KEY (genre_id) REFERENCES genres (id) ON DELETE CASCADE,
  CONSTRAINT novel_genres_position_check CHECK (position >= 0)
);

CREATE INDEX IF NOT EXISTS idx_novel_genres_genre ON novel_genres (genre_id);
CREATE INDEX IF NOT EXISTS idx_novel_genres_novel_position ON novel_genres (novel_id, position);

-- ============================================================================
-- 6. chapters
--    Nguồn: types.ts:1-10
--
--    QUAN TRỌNG (F2): chapter slug KHÔNG unique toàn cục — 'ch-42' tồn tại ở
--    cả shadow-of-the-void (mockData.ts:42) lẫn eternal-archive (mockData.ts:71).
--    Vì vậy UNIQUE phải là (novel_id, slug), và API buộc phải nested:
--    GET /api/novels/:novelSlug/chapters/:chapterSlug
--
--    published_at là timestamptz; presenter format thành 'Oct 12, 2023' (F3).
-- ============================================================================
CREATE TABLE IF NOT EXISTS chapters (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id         uuid         NOT NULL,
  slug             varchar(60)  NOT NULL,
  number           integer      NOT NULL,
  title            varchar(300) NOT NULL,
  published_at     timestamptz  NOT NULL DEFAULT now(),
  illustration_url text,
  word_count       integer,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT chapters_novel_fk FOREIGN KEY (novel_id) REFERENCES novels (id) ON DELETE CASCADE,
  CONSTRAINT chapters_novel_slug_unique   UNIQUE (novel_id, slug),
  CONSTRAINT chapters_novel_number_unique UNIQUE (novel_id, number),
  CONSTRAINT chapters_number_check        CHECK (number > 0),
  CONSTRAINT chapters_word_count_check    CHECK (word_count IS NULL OR word_count >= 0)
);

DROP TRIGGER IF EXISTS trg_chapters_updated_at ON chapters;
CREATE TRIGGER trg_chapters_updated_at
  BEFORE UPDATE ON chapters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ReaderView.tsx:28-31 tính prev/next theo thứ tự number tăng dần
CREATE INDEX IF NOT EXISTS idx_chapters_novel_number ON chapters (novel_id, number ASC);

-- ============================================================================
-- 7. chapter_contents
--    Nguồn: Chapter.content?: string[] (types.ts:7) — ReaderView.tsx:127 render
--    mỗi phần tử thành một thẻ <p>.
--
--    Tách khỏi `chapters` để GET /api/novels/:slug (có novel 243 chương)
--    không kéo theo toàn bộ body text.
-- ============================================================================
CREATE TABLE IF NOT EXISTS chapter_contents (
  chapter_id uuid        PRIMARY KEY,
  paragraphs text[]      NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chapter_contents_chapter_fk
    FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE,
  CONSTRAINT chapter_contents_not_empty CHECK (array_length(paragraphs, 1) >= 1)
);

DROP TRIGGER IF EXISTS trg_chapter_contents_updated_at ON chapter_contents;
CREATE TRIGGER trg_chapter_contents_updated_at
  BEFORE UPDATE ON chapter_contents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 8. bookmarks  🔒 per-user
--    Nguồn: Novel.isBookmarked (types.ts:41), App.tsx:85-92
-- ============================================================================
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id    uuid        NOT NULL,
  novel_id   uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bookmarks_pkey     PRIMARY KEY (user_id, novel_id),
  CONSTRAINT bookmarks_user_fk  FOREIGN KEY (user_id)  REFERENCES users  (id) ON DELETE CASCADE,
  CONSTRAINT bookmarks_novel_fk FOREIGN KEY (novel_id) REFERENCES novels (id) ON DELETE CASCADE
);

-- ProfileView.tsx:18 — liệt kê bookmark của user, mới nhất trước
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created ON bookmarks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_novel        ON bookmarks (novel_id);

-- ============================================================================
-- 9. reading_progress  🔒 per-user, 1 dòng cho mỗi (user, novel)
--    Nguồn: Novel.lastReadChapterId (types.ts:39) + lastReadProgress (types.ts:40)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reading_progress (
  user_id         uuid        NOT NULL,
  novel_id        uuid        NOT NULL,
  last_chapter_id uuid,
  progress        smallint    NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reading_progress_pkey    PRIMARY KEY (user_id, novel_id),
  CONSTRAINT reading_progress_user_fk FOREIGN KEY (user_id)  REFERENCES users  (id) ON DELETE CASCADE,
  CONSTRAINT reading_progress_novel_fk FOREIGN KEY (novel_id) REFERENCES novels (id) ON DELETE CASCADE,
  -- SET NULL chứ không CASCADE: xoá 1 chương không được xoá cả tiến độ đọc novel
  CONSTRAINT reading_progress_chapter_fk
    FOREIGN KEY (last_chapter_id) REFERENCES chapters (id) ON DELETE SET NULL,
  CONSTRAINT reading_progress_range_check CHECK (progress BETWEEN 0 AND 100)
);

-- GET /api/library/history + HomeView.tsx:21 Continue Reading
CREATE INDEX IF NOT EXISTS idx_reading_progress_user_updated
  ON reading_progress (user_id, updated_at DESC);

-- ============================================================================
-- 10. chapter_reads  🔒 per-user, 1 dòng cho mỗi (user, chapter)
--     Nguồn: Chapter.isRead (types.ts:6), ghi tại App.tsx:67-69
-- ============================================================================
CREATE TABLE IF NOT EXISTS chapter_reads (
  user_id    uuid        NOT NULL,
  chapter_id uuid        NOT NULL,
  read_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chapter_reads_pkey       PRIMARY KEY (user_id, chapter_id),
  CONSTRAINT chapter_reads_user_fk    FOREIGN KEY (user_id)    REFERENCES users    (id) ON DELETE CASCADE,
  CONSTRAINT chapter_reads_chapter_fk FOREIGN KEY (chapter_id) REFERENCES chapters (id) ON DELETE CASCADE
);

-- Dùng để tính stats.chaptersRead và stats.streakDays trong GET /api/auth/me
CREATE INDEX IF NOT EXISTS idx_chapter_reads_user_read_at ON chapter_reads (user_id, read_at DESC);
CREATE INDEX IF NOT EXISTS idx_chapter_reads_chapter      ON chapter_reads (chapter_id);

-- ============================================================================
-- 11. group_follows  🔒 per-user
--     Nguồn: TranslationGroup.isFollowed (types.ts:17), NovelDetailView.tsx:283
-- ============================================================================
CREATE TABLE IF NOT EXISTS group_follows (
  user_id    uuid        NOT NULL,
  group_id   uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT group_follows_pkey     PRIMARY KEY (user_id, group_id),
  CONSTRAINT group_follows_user_fk  FOREIGN KEY (user_id)  REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT group_follows_group_fk FOREIGN KEY (group_id) REFERENCES translation_groups (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_group_follows_group ON group_follows (group_id);

-- ============================================================================
-- 12. novel_recommendations
--     Nguồn: Novel.recommendationsAvatars (types.ts:38) + recommendationsCount
--     (types.ts:37), render tại NovelDetailView.tsx:326-338.
--
--     Chỉ ĐỌC — frontend không có nút "recommend" nào, nên không có endpoint ghi.
--     recommendationsCount = COUNT(*), recommendationsAvatars = 3 avatar đầu.
-- ============================================================================
CREATE TABLE IF NOT EXISTS novel_recommendations (
  user_id    uuid        NOT NULL,
  novel_id   uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT novel_recommendations_pkey     PRIMARY KEY (user_id, novel_id),
  CONSTRAINT novel_recommendations_user_fk  FOREIGN KEY (user_id)  REFERENCES users  (id) ON DELETE CASCADE,
  CONSTRAINT novel_recommendations_novel_fk FOREIGN KEY (novel_id) REFERENCES novels (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_novel_recommendations_novel ON novel_recommendations (novel_id, created_at DESC);

-- ============================================================================
-- 13. sync_events  —  Nguồn: TimelineItem (types.ts:44-54)
--
--     Trong mock, TimelineItem.novelId trỏ tới novel không tồn tại
--     ('neon-chronicles', mockData.ts:257) và TimelineView.tsx:119 phải fallback
--     `|| novels[0]`. Ở DB đây là FK thật nên vấn đề đó biến mất.
--
--     occurred_at là timestamptz; presenter derive timeAgo/month/year (F3).
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_events (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id             uuid        NOT NULL,
  translation_group_id uuid,
  chapters_added_count integer     NOT NULL,
  occurred_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sync_events_novel_fk FOREIGN KEY (novel_id) REFERENCES novels (id) ON DELETE CASCADE,
  CONSTRAINT sync_events_group_fk
    FOREIGN KEY (translation_group_id) REFERENCES translation_groups (id) ON DELETE SET NULL,
  CONSTRAINT sync_events_count_check CHECK (chapters_added_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_sync_events_occurred_at ON sync_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_events_novel       ON sync_events (novel_id);

-- ============================================================================
-- 14. sync_runs
--     Nguồn: SyncStats.nextSyncCountdown + nextSyncPercentage (types.ts:61-62),
--     render tại TimelineView.tsx:210-232.
--
--     Tách khỏi sync_events vì SyncStats gộp hai loại dữ liệu khác bản chất:
--     thống kê tích luỹ (từ sync_events) và trạng thái lần chạy hiện tại (bảng này).
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_runs (
  id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  status              sync_run_status NOT NULL DEFAULT 'running',
  progress_percentage smallint        NOT NULL DEFAULT 0,
  started_at          timestamptz     NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  next_run_at         timestamptz,

  CONSTRAINT sync_runs_progress_check CHECK (progress_percentage BETWEEN 0 AND 100),
  CONSTRAINT sync_runs_finished_check CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON sync_runs (started_at DESC);

-- ============================================================================
-- Reference data: genres
--
-- Đây KHÔNG phải fake data — là 8 genre đang hardcode ở DiscoverView.tsx:14
-- (trừ 'All' vì đó là trạng thái UI, không phải genre) hợp với các genre thực tế
-- xuất hiện trong Novel.genres. Không có genre nào được bịa thêm.
-- ============================================================================
INSERT INTO genres (slug, name) VALUES
  ('fantasy',       'Fantasy'),
  ('cyberpunk',     'Cyberpunk'),
  ('mystery',       'Mystery'),
  ('action',        'Action'),
  ('slice-of-life', 'Slice of Life'),
  ('romance',       'Romance'),
  ('seinen',        'Seinen'),
  ('psychological', 'Psychological'),
  ('magic',         'Magic'),
  ('gothic',        'Gothic'),
  ('adventure',     'Adventure'),
  ('sci-fi',        'Sci-Fi'),
  ('thriller',      'Thriller'),
  ('xianxia',       'Xianxia'),
  ('dark',          'Dark')
ON CONFLICT (slug) DO NOTHING;

COMMIT;
