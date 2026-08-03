-- ============================================================================
-- 001_status_enum.sql  —  D2: mở rộng novel_status
--
--   npm run db:migrate:001
--
-- ⚠️ FILE NÀY CỐ Ý KHÔNG CÓ BEGIN/COMMIT.
--
-- PostgreSQL cho phép `ALTER TYPE ... ADD VALUE` bên trong transaction block
-- (từ PG 12), NHƯNG giá trị mới KHÔNG được dùng trong chính transaction đó.
-- Tách riêng file này để mọi backfill hay INSERT có dùng 'Dropped'/'Unknown'
-- về sau đều chắc chắn nằm ở transaction khác.
--
-- 🔴 THAY ĐỔI NÀY PHÁ HỢP ĐỒNG TYPE VỚI FRONTEND.
-- Phải sửa kèm, nếu không `tsc` frontend sẽ fail ngay khi API trả về 'Dropped':
--   - Lumiere_frontend/src/types.ts        -> union Novel.status
--   - Lumiere_backend/src/models/index.ts  -> type NovelStatus
--   - Lumiere_backend/src/schemas/novel.schema.ts -> novelQuerySchema.status
--
-- Idempotent: IF NOT EXISTS, chạy lại nhiều lần an toàn.
-- ============================================================================

ALTER TYPE novel_status ADD VALUE IF NOT EXISTS 'Dropped';
ALTER TYPE novel_status ADD VALUE IF NOT EXISTS 'Unknown';
