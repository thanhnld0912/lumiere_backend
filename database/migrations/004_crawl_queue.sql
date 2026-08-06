-- ============================================================================
-- 004_crawl_queue.sql  —  hàng đợi refresh, lưu bền
--
--   npm run db:migrate:004   (chạy SAU 003)
--
-- VÌ SAO CẦN BẢNG NÀY
--
-- `discover` và `latest` phát hiện novel chưa có trong database. Cả hai CỐ Ý
-- không tự nạp: trang danh mục và feed chương mới không có genre, mô tả hay
-- rating, tạo bản ghi từ đó sẽ ra novel rỗng ruột.
--
-- Trước migration này, "hàng đợi" chỉ là một mảng trong bộ nhớ mà
-- `CrawlerService` rút cạn NGAY trong cùng tiến trình. Nghĩa là một lần chạy
-- `latest` — vốn phải rẻ và chạy 6 giờ một lần — kéo theo cả một lượt refresh
-- đầy đủ: metadata + mục lục + nội dung chương. Khi refresh học được cách tải
-- nội dung (mỗi chương một request), `latest` từ vài giây thành hơn 30 phút và
-- bị GitHub Actions giết.
--
-- Ghi hàng đợi xuống database tách được hai việc đó ra: job rẻ chỉ GHI TÊN việc,
-- job đắt mới LÀM việc, và mỗi bên có lịch chạy với ngân sách riêng.
--
-- VÌ SAO KHÔNG DÙNG `novel_sources`
--
-- `novel_sources.novel_id` là NOT NULL và tham chiếu `novels(id)`. Novel vừa
-- phát hiện thì chưa có dòng nào trong `novels` — đó chính là lý do nó nằm trong
-- hàng đợi. Không có chỗ hợp lệ để đặt nó ở bảng kia.
--
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS crawl_queue (
  source_id   uuid         NOT NULL,
  external_id varchar(200) NOT NULL,   -- id/slug bên site nguồn
  source_url  text         NOT NULL,

  -- 'discover' | 'latest'. Giữ lại để biết việc này từ đâu ra khi cần điều tra.
  reason      varchar(40)  NOT NULL,

  enqueued_at timestamptz  NOT NULL DEFAULT now(),

  -- Số lần refresh đã thử mà thất bại.
  --
  -- Không có cột này thì MỘT external_id hỏng vĩnh viễn (truyện bị gỡ, id sai)
  -- sẽ luôn đứng đầu hàng đợi và chặn mọi việc phía sau ở mọi lần chạy.
  attempts    smallint     NOT NULL DEFAULT 0,
  last_error  text,

  -- Khoá chính giống `novel_sources`: (nguồn, id bên nguồn) là danh tính chắc
  -- chắn. Nhờ vậy enqueue lại cùng một novel là no-op, không cần lọc trước.
  CONSTRAINT crawl_queue_pkey PRIMARY KEY (source_id, external_id),

  CONSTRAINT crawl_queue_source_fk FOREIGN KEY (source_id)
    REFERENCES sources (id) ON DELETE CASCADE,

  CONSTRAINT crawl_queue_attempts_check CHECK (attempts >= 0)
);

-- RunPlanner lấy việc: ít lỗi trước, cũ trước. Item hỏng tự chìm xuống đáy.
CREATE INDEX IF NOT EXISTS idx_crawl_queue_pending
  ON crawl_queue (source_id, attempts, enqueued_at);
