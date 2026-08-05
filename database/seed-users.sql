-- ============================================================================
-- seed-users.sql  —  Hai tài khoản mẫu để phát triển và vận hành
--
--   npm run db:seed:users
--
-- ⚠️ CHỈ DÙNG CHO MÔI TRƯỜNG DEV.
--
-- Mật khẩu dưới đây là mật khẩu yếu và hash của chúng nằm công khai trong repo.
-- Trên production phải tạo tài khoản qua POST /api/auth/register rồi nâng quyền
-- bằng câu UPDATE ở cuối file này.
--
-- Idempotent: ON CONFLICT DO UPDATE, chạy lại nhiều lần an toàn.
-- ============================================================================

BEGIN;

INSERT INTO users (email, password_hash, display_name, role, avatar_url) VALUES
  (
    'reader@lumiere.app',
    -- LumiereUser123
    '$2a$12$mbZ.nSy5SSnnIp.cI.wtyO7KFekekQKwrACtvdFlrg7EWnQOQfzXq',
    'Archivist Traveler',
    'user',
    NULL
  ),
  (
    'admin@lumiere.app',
    -- LumiereAdmin123
    '$2a$12$8bfg50wozJoqo6xLtkqyvumicdk7MTB3AaGxsLcrcyNbqYTPgithi',
    'Lumiere Admin',
    'admin',
    NULL
  )
ON CONFLICT (email) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      display_name  = EXCLUDED.display_name,
      -- Cập nhật cả role: chạy lại file này là cách nhanh nhất để khôi phục
      -- quyền admin nếu lỡ đổi nhầm.
      role          = EXCLUDED.role;

COMMIT;

-- ============================================================================
-- Nâng quyền admin cho một tài khoản CÓ THẬT (cách dùng trên production)
--
-- Không có endpoint nào cho phép tự nâng quyền — đó là chủ đích. Muốn có admin
-- thì phải chạm tay vào database, và điều đó nên khó.
-- ============================================================================
--
-- UPDATE users SET role = 'admin' WHERE email = 'ban@example.com';
