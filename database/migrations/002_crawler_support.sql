-- ============================================================================
-- 002_crawler_support.sql  —  hạ tầng dữ liệu cho crawler multi-source
--
--   npm run db:migrate:002   (chạy SAU 001)
--
-- Chỉ THÊM bảng/cột. Không sửa, không xoá cột nào đang có
-- -> REST API hiện tại chạy nguyên vẹn, không cần deploy lại.
--
-- Idempotent.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. sources — nền tảng cho mục tiêu "hàng trăm site"
--
-- Mỗi nguồn là một Source Adapter ở tầng code. Bảng này là danh bạ của chúng.
-- ============================================================================
CREATE TABLE IF NOT EXISTS sources (
  id         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       varchar(60)  NOT NULL,          -- 'novelupdates', 'royalroad', …
  name       varchar(120) NOT NULL,
  base_url   text         NOT NULL,
  is_enabled boolean      NOT NULL DEFAULT true,
  created_at timestamptz  NOT NULL DEFAULT now(),
  updated_at timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT sources_slug_unique UNIQUE (slug),
  CONSTRAINT sources_slug_check  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

DROP TRIGGER IF EXISTS trg_sources_updated_at ON sources;
CREATE TRIGGER trg_sources_updated_at
  BEFORE UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 2. novel_sources — TRÁI TIM của dedup + update detection
--
-- Một novel có thể xuất hiện ở nhiều nguồn. Bảng này trả lời ba câu hỏi mà
-- crawler hỏi liên tục:
--   "novel này đã crawl chưa?"           -> (source_id, external_id)
--   "dữ liệu có gì đổi không?"           -> content_hash
--   "novel nào cũ nhất, cần refresh?"    -> last_crawled_at
-- ============================================================================
CREATE TABLE IF NOT EXISTS novel_sources (
  novel_id        uuid         NOT NULL,
  source_id       uuid         NOT NULL,
  external_id     varchar(200) NOT NULL,   -- id/slug bên site nguồn
  source_url      text         NOT NULL,   -- <- "NovelUpdates URL"
  content_hash    char(64),                -- sha256 của NormalizedNovel
  last_crawled_at timestamptz,
  last_changed_at timestamptz,
  created_at      timestamptz  NOT NULL DEFAULT now(),

  -- Khoá chính là (nguồn, id bên nguồn): đây là danh tính CHẮC CHẮN của
  -- một bản ghi ngoại, không phụ thuộc vào việc ta gộp novel thế nào.
  CONSTRAINT novel_sources_pkey PRIMARY KEY (source_id, external_id),

  -- Một novel chỉ được map tối đa một lần vào mỗi nguồn.
  CONSTRAINT novel_sources_novel_source_unique UNIQUE (novel_id, source_id),

  CONSTRAINT novel_sources_novel_fk  FOREIGN KEY (novel_id)  REFERENCES novels  (id) ON DELETE CASCADE,
  CONSTRAINT novel_sources_source_fk FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE CASCADE
);

-- RunPlanner: chọn novel cũ nhất để refresh. NULLS FIRST = chưa crawl bao giờ -> ưu tiên cao nhất.
CREATE INDEX IF NOT EXISTS idx_novel_sources_stale
  ON novel_sources (source_id, last_crawled_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_novel_sources_novel ON novel_sources (novel_id);

-- ============================================================================
-- 3. novel_alt_titles — tên khác (dùng cho dedup + search)
-- ============================================================================
CREATE TABLE IF NOT EXISTS novel_alt_titles (
  novel_id uuid         NOT NULL,
  title    varchar(300) NOT NULL,
  position smallint     NOT NULL DEFAULT 0,

  CONSTRAINT novel_alt_titles_pkey     PRIMARY KEY (novel_id, title),
  CONSTRAINT novel_alt_titles_novel_fk FOREIGN KEY (novel_id) REFERENCES novels (id) ON DELETE CASCADE
);

-- Dedup so khớp không phân biệt hoa thường.
CREATE INDEX IF NOT EXISTS idx_novel_alt_titles_norm ON novel_alt_titles (lower(title));

-- ============================================================================
-- 4. tags — KHÁC genres
--
-- NovelUpdates có ~50 genre (phân loại lớn, hữu hạn) nhưng HÀNG NGHÌN tag
-- ('Male Protagonist', 'Slow Romance', …). Nhét chung vào `genres` sẽ làm hỏng
-- bộ lọc genre của DiscoverView.
-- ============================================================================
CREATE TABLE IF NOT EXISTS tags (
  id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(80) NOT NULL,
  name varchar(80) NOT NULL,

  CONSTRAINT tags_slug_unique UNIQUE (slug),
  CONSTRAINT tags_name_unique UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS novel_tags (
  novel_id uuid NOT NULL,
  tag_id   uuid NOT NULL,

  CONSTRAINT novel_tags_pkey     PRIMARY KEY (novel_id, tag_id),
  CONSTRAINT novel_tags_novel_fk FOREIGN KEY (novel_id) REFERENCES novels (id) ON DELETE CASCADE,
  CONSTRAINT novel_tags_tag_fk   FOREIGN KEY (tag_id)   REFERENCES tags   (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_novel_tags_tag ON novel_tags (tag_id);

-- ============================================================================
-- 5. Cột mới trên novels
-- ============================================================================

-- Metadata crawl được
ALTER TABLE novels ADD COLUMN IF NOT EXISTS language           varchar(40);
ALTER TABLE novels ADD COLUMN IF NOT EXISTS original_publisher varchar(200);

-- D6: FK, KHÔNG phải chuỗi 'novelupdates'.
-- Lưu chuỗi sẽ biến thành một enum ngầm không ai kiểm soát khi có 100 nguồn.
-- novel_sources vẫn là nguồn sự thật quan hệ n-n; cột này chỉ là lối tắt.
ALTER TABLE novels ADD COLUMN IF NOT EXISTS primary_source_id  uuid;

DO $$ BEGIN
  ALTER TABLE novels ADD CONSTRAINT novels_primary_source_fk
    FOREIGN KEY (primary_source_id) REFERENCES sources (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- D6: điểm xếp hạng, tính theo batch bởi RecomputeScoresJob (không tính lúc đọc)
ALTER TABLE novels ADD COLUMN IF NOT EXISTS popularity_score numeric(12,4) NOT NULL DEFAULT 0;
ALTER TABLE novels ADD COLUMN IF NOT EXISTS trending_score   numeric(12,4) NOT NULL DEFAULT 0;

-- D6: HAI mốc thời gian KHÁC NHAU — đừng gộp.
--   last_synced_at  : lần cuối CRAWLER ghé qua  -> RunPlanner dùng
--   last_chapter_at : lần cuối CÓ CHƯƠNG MỚI    -> section "Recently Updated" dùng
-- Dùng nhầm cột đầu cho "Recently Updated" sẽ khiến cả 5.000 novel cùng
-- "vừa cập nhật" ngay sau mỗi lần crawl.
ALTER TABLE novels ADD COLUMN IF NOT EXISTS last_synced_at  timestamptz;
ALTER TABLE novels ADD COLUMN IF NOT EXISTS last_chapter_at timestamptz;

-- D6 update_frequency: số THÔ. Cột `release_frequency` (chuỗi '3 Chapters / Week')
-- giữ nguyên và do presenter layer sinh ra — đúng nguyên tắc đã chốt ở Q1.
ALTER TABLE novels ADD COLUMN IF NOT EXISTS release_rate_per_week numeric(6,2);

-- D6 "Most Followed": counter denormalized, duy trì bằng trigger ở mục 7.
ALTER TABLE novels ADD COLUMN IF NOT EXISTS bookmarks_count integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE novels ADD CONSTRAINT novels_bookmarks_count_check CHECK (bookmarks_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Index cho 5 section Home
CREATE INDEX IF NOT EXISTS idx_novels_trending     ON novels (trending_score   DESC);
CREATE INDEX IF NOT EXISTS idx_novels_popularity   ON novels (popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_novels_last_chapter ON novels (last_chapter_at  DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_novels_bookmarks    ON novels (bookmarks_count  DESC);
CREATE INDEX IF NOT EXISTS idx_novels_language     ON novels (language);

-- ============================================================================
-- 6. Gắn nguồn vào log sync đã có (feed cho GET /api/timeline)
-- ============================================================================
ALTER TABLE sync_runs   ADD COLUMN IF NOT EXISTS source_id uuid;
ALTER TABLE sync_runs   ADD COLUMN IF NOT EXISTS mode      varchar(20);
ALTER TABLE sync_events ADD COLUMN IF NOT EXISTS source_id uuid;

DO $$ BEGIN
  ALTER TABLE sync_runs ADD CONSTRAINT sync_runs_source_fk
    FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE sync_events ADD CONSTRAINT sync_events_source_fk
    FOREIGN KEY (source_id) REFERENCES sources (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE sync_runs ADD CONSTRAINT sync_runs_mode_check
    CHECK (mode IS NULL OR mode IN ('discover', 'refresh', 'latest'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 7. bookmarks_count — duy trì bằng TRIGGER, KHÔNG sửa API
--
-- Bookmark được ghi qua POST/DELETE /api/novels/:slug/bookmark. Yêu cầu là
-- không đụng vào API, nên counter được giữ đồng bộ ở tầng database. Cách này
-- còn đúng cả khi có ai đó sửa bảng bookmarks bằng SQL trực tiếp.
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_bookmarks_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE novels SET bookmarks_count = bookmarks_count + 1 WHERE id = NEW.novel_id;
  ELSIF TG_OP = 'DELETE' THEN
    -- GREATEST: counter không bao giờ được âm, kể cả nếu dữ liệu từng lệch.
    UPDATE novels SET bookmarks_count = GREATEST(bookmarks_count - 1, 0) WHERE id = OLD.novel_id;
  END IF;
  RETURN NULL;   -- AFTER trigger, giá trị trả về bị bỏ qua
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookmarks_count ON bookmarks;
CREATE TRIGGER trg_bookmarks_count
  AFTER INSERT OR DELETE ON bookmarks
  FOR EACH ROW EXECUTE FUNCTION sync_bookmarks_count();

-- Backfill cho bookmark đã tồn tại trước khi có trigger.
UPDATE novels n
SET bookmarks_count = COALESCE(
  (SELECT COUNT(*) FROM bookmarks b WHERE b.novel_id = n.id), 0
);

-- ============================================================================
-- 8. Đăng ký nguồn đầu tiên + gắn dữ liệu seed hiện có vào nó
-- ============================================================================
INSERT INTO sources (slug, name, base_url)
VALUES ('novelupdates', 'NovelUpdates', 'https://www.novelupdates.com')
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name, base_url = EXCLUDED.base_url;

COMMIT;
