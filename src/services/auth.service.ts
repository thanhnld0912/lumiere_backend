import { queryOne } from '../config/database';
import type { AuthResponseDto, MeResponseDto, UserDto, UserRow, UserStatsDto } from '../models';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema';
import { ApiError } from '../utils/ApiError';
import { signAccessToken } from '../utils/jwt';
import { hashPassword, verifyPassword } from '../utils/password';

function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
  };
}

function buildAuthResponse(row: UserRow): AuthResponseDto {
  const user = toUserDto(row);
  return {
    token: signAccessToken({ userId: user.id, email: user.email, role: user.role }),
    user,
  };
}

/** POST /api/auth/register */
export async function register(input: RegisterInput): Promise<AuthResponseDto> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = $1', [
    input.email,
  ]);
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);

  const row = await queryOne<UserRow>(
    `
    INSERT INTO users (email, password_hash, display_name)
    VALUES ($1, $2, $3)
    RETURNING *
    `,
    [input.email, passwordHash, input.displayName],
  );

  if (!row) {
    throw new Error('Insert user returned no row');
  }

  return buildAuthResponse(row);
}

/** POST /api/auth/login */
export async function login(input: LoginInput): Promise<AuthResponseDto> {
  const row = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [input.email]);

  // Cùng một message cho cả "email không tồn tại" lẫn "sai mật khẩu" để không
  // biến endpoint này thành công cụ dò xem email nào đã đăng ký.
  const invalidCredentials = ApiError.unauthorized('Invalid email or password');

  if (!row) {
    // Vẫn băm một lần để thời gian phản hồi không tiết lộ email có tồn tại hay
    // không (timing attack). Chi phí ~250ms, chấp nhận được ở endpoint login.
    await hashPassword(input.password);
    throw invalidCredentials;
  }

  const isValid = await verifyPassword(input.password, row.password_hash);
  if (!isValid) {
    throw invalidCredentials;
  }

  return buildAuthResponse(row);
}

/**
 * Tính streak số ngày đọc liên tiếp tính tới hôm nay (hoặc hôm qua — vẫn tính
 * là streak đang chạy nếu người dùng chưa đọc gì hôm nay).
 *
 * ProfileView.tsx:45 hiện hardcode '42 Days Streak'; đây là nguồn dữ liệu thật
 * thay thế, derive hoàn toàn từ chapter_reads.read_at.
 */
const STREAK_SQL = `
  WITH read_days AS (
    SELECT DISTINCT (read_at AT TIME ZONE 'UTC')::date AS day
    FROM chapter_reads
    WHERE user_id = $1
  ),
  -- Kỹ thuật "gaps and islands": ngày liên tiếp thì (day - row_number) không đổi,
  -- nên nhóm theo hiệu đó sẽ tách được từng chuỗi ngày liên tục.
  grouped AS (
    SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::int AS streak_group
    FROM read_days
  ),
  streaks AS (
    SELECT COUNT(*)::int AS length, MAX(day) AS last_day
    FROM grouped
    GROUP BY streak_group
  )
  SELECT COALESCE(
    (SELECT length FROM streaks
     WHERE last_day >= (now() AT TIME ZONE 'UTC')::date - 1
     ORDER BY last_day DESC
     LIMIT 1),
    0
  ) AS streak_days
`;

/** GET /api/auth/me — gồm cả stats mà ProfileView đang render. */
export async function getMe(userId: string): Promise<MeResponseDto> {
  const row = await queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
  if (!row) {
    // Token hợp lệ nhưng user đã bị xoá.
    throw ApiError.unauthorized('User no longer exists');
  }

  const stats = await queryOne<{
    chapters_read: string;
    bookmarks_count: string;
    streak_days: number;
  }>(
    `
    SELECT
      (SELECT COUNT(*)::text FROM chapter_reads WHERE user_id = $1) AS chapters_read,
      (SELECT COUNT(*)::text FROM bookmarks     WHERE user_id = $1) AS bookmarks_count,
      (${STREAK_SQL}) AS streak_days
    `,
    [userId],
  );

  const userStats: UserStatsDto = {
    chaptersRead: stats ? Number.parseInt(stats.chapters_read, 10) : 0,
    bookmarksCount: stats ? Number.parseInt(stats.bookmarks_count, 10) : 0,
    streakDays: stats?.streak_days ?? 0,
  };

  return { ...toUserDto(row), stats: userStats };
}