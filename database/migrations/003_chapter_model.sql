-- ============================================================================
-- 003_chapter_model.sql  —  D1: mô hình chương phản ánh đúng NovelUpdates
--
--   npm run db:migrate:003   (chạy SAU 002)
--
-- NovelUpdates đặt tên chương theo nhiều dạng:
--     Chapter 243
--     Chapter 243: Return
--     Vol 5 Chapter 243
--     Extra Chapter 12
--     c.243.5  /  c.243 part2
--
-- Không được hardcode 'Chapter 243'. Thay vào đó tách thành các trường có cấu
-- trúc, giữ nguyên chuỗi gốc để re-parse được về sau.
--
-- ⚠️ Migration này SỬA một bảng đang được API đọc. Nó KHÔNG đổi shape JSON —
-- các cột mới không xuất hiện trong ChapterDto.
--
-- Idempotent.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. 🔴 BỎ UNIQUE (novel_id, number)
--
-- Ràng buộc này chặn ĐÚNG dữ liệu hợp lệ khi có chương extra:
--     'Chapter 12'        -> number = 12, is_extra = false
--     'Extra Chapter 12'  -> number = 12, is_extra = TRUE   <- va chạm, crawler chết
--
-- Danh tính chương vẫn an toàn: UNIQUE (novel_id, slug) đã có từ schema gốc và
-- vẫn là định danh chính thức.
-- ============================================================================
ALTER TABLE chapters DROP CONSTRAINT IF EXISTS chapters_novel_number_unique;

-- ============================================================================
-- 2. Cột mới
--
-- CỐ Ý KHÔNG đổi `number` sang numeric để chứa 'c.243.5':
-- pg trả numeric về dưới dạng STRING, sẽ làm ChapterDto.number: number gãy và
-- buộc phải sửa cả backend lẫn frontend. Tách part_number giữ number là integer.
-- ============================================================================
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS volume_number smallint;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS part_number   smallint;   -- 'c.243.5' -> part 5
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS is_extra      boolean NOT NULL DEFAULT false;
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS raw_title     text;       -- verbatim từ nguồn
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS display_title varchar(300);
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS sort_index    bigint;

COMMENT ON COLUMN chapters.raw_title IS
  'Chuỗi tiêu đề nguyên trạng từ nguồn. Giữ lại để re-parse khi cải tiến extractor mà không cần crawl lại.';
COMMENT ON COLUMN chapters.title IS
  'CHỈ tên riêng của chương (VD ''Return''), đã bỏ tiền tố. Frontend render "Chapter {number}: {title}".';
COMMENT ON COLUMN chapters.display_title IS
  'Nhãn trọn vẹn (VD ''Vol 5 Chapter 243: Return'') cho nơi cần một chuỗi duy nhất.';

-- ============================================================================
-- 3. Ràng buộc phạm vi — bảo vệ công thức sort_index khỏi tràn bậc
--
-- sort_index dồn 4 trường vào một bigint theo bậc 1e12 / 1e6 / 1e3 / 1e0.
-- Nếu `number` vượt 999.999 nó sẽ tràn sang bậc của volume và làm hỏng thứ tự.
-- Các CHECK dưới đây biến lỗi âm thầm đó thành lỗi ghi rõ ràng.
-- ============================================================================

-- NovelUpdates có chương mở đầu 'c.0' -> nới từ (> 0) thành (>= 0)
ALTER TABLE chapters DROP CONSTRAINT IF EXISTS chapters_number_check;

DO $$ BEGIN
  ALTER TABLE chapters ADD CONSTRAINT chapters_number_check
    CHECK (number >= 0 AND number < 1000000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE chapters ADD CONSTRAINT chapters_volume_check
    CHECK (volume_number IS NULL OR (volume_number >= 0 AND volume_number < 10000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE chapters ADD CONSTRAINT chapters_part_check
    CHECK (part_number IS NULL OR (part_number >= 0 AND part_number < 1000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- 4. sort_index — thứ tự đọc TƯỜNG MINH
--
-- Vì sao cần: ReaderView.tsx:28-31 tính chương trước/sau bằng INDEX TRONG MẢNG,
-- và API trả theo thứ tự SQL. Khi có volume + extra + part thì `number` không
-- còn là thứ tự đọc — sắp theo number sẽ đẩy 'Extra Chapter 12' lên TRƯỚC
-- 'Chapter 243'.
--
-- Bậc:  volume × 1e12  +  number × 1e6  +  part × 1e3  +  is_extra
-- Extra xếp NGAY SAU chương thường cùng số (+1 ở bậc thấp nhất).
-- Giá trị lớn nhất ≈ 1e16, thừa sức nằm trong bigint (9.22e18).
--
-- Normalizer bên crawler tự tính và gán giá trị này (theo D1). Trigger dưới đây
-- chỉ là LƯỚI AN TOÀN cho seed.sql và các INSERT thủ công — không có nó, chạy
-- lại seed.sql sẽ tạo ra chương có sort_index NULL và làm hỏng thứ tự đọc.
-- ============================================================================
CREATE OR REPLACE FUNCTION compute_chapter_sort_index()
RETURNS TRIGGER AS $$
DECLARE
  computed bigint;
BEGIN
  computed :=
      COALESCE(NEW.volume_number, 0)::bigint * 1000000000000
    + NEW.number::bigint                     * 1000000
    + COALESCE(NEW.part_number, 0)::bigint   * 1000
    + CASE WHEN NEW.is_extra THEN 1 ELSE 0 END;

  IF TG_OP = 'INSERT' THEN
    IF NEW.sort_index IS NULL THEN
      NEW.sort_index := computed;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Tính lại khi: chưa có giá trị, HOẶC các trường thành phần đổi mà người
    -- gọi không tự cập nhật sort_index (nếu họ có set thì tôn trọng — cho phép
    -- adapter của nguồn khác dùng quy tắc sắp xếp riêng).
    IF NEW.sort_index IS NULL
       OR (
            NEW.sort_index IS NOT DISTINCT FROM OLD.sort_index
            AND (NEW.number, NEW.volume_number, NEW.part_number, NEW.is_extra)
                IS DISTINCT FROM
                (OLD.number, OLD.volume_number, OLD.part_number, OLD.is_extra)
          )
    THEN
      NEW.sort_index := computed;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chapters_sort_index ON chapters;
CREATE TRIGGER trg_chapters_sort_index
  BEFORE INSERT OR UPDATE ON chapters
  FOR EACH ROW EXECUTE FUNCTION compute_chapter_sort_index();

-- Index cho ORDER BY mới
CREATE INDEX IF NOT EXISTS idx_chapters_novel_sort ON chapters (novel_id, sort_index);

-- ============================================================================
-- 5. Backfill cho chương đã có (từ seed.sql)
-- ============================================================================

-- 5a. sort_index
UPDATE chapters
SET sort_index =
      COALESCE(volume_number, 0)::bigint * 1000000000000
    + number::bigint                     * 1000000
    + COALESCE(part_number, 0)::bigint   * 1000
    + CASE WHEN is_extra THEN 1 ELSE 0 END
WHERE sort_index IS NULL;

-- 5b. display_title — dựng từ dữ liệu ĐANG CÓ, không bịa thêm gì.
--     `raw_title` cố ý để NULL: dữ liệu seed không đến từ crawl nên không có
--     chuỗi gốc nào cả. NULL ở đây là trung thực, không phải thiếu sót.
UPDATE chapters
SET display_title = CASE
      WHEN title IS NULL OR btrim(title) = '' THEN 'Chapter ' || number
      ELSE 'Chapter ' || number || ': ' || title
    END
WHERE display_title IS NULL;

COMMIT;
