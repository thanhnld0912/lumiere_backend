import { z } from 'zod';

/**
 * Slug xuất hiện trong URL. Ràng buộc regex vừa để validate, vừa là một lớp
 * phòng thủ: mọi giá trị lọt qua đây chắc chắn không chứa ký tự lạ.
 * (Truy vấn vẫn luôn tham số hoá — đây chỉ là lớp thứ hai.)
 */
const slugField = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(160, 'Slug is too long')
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Invalid slug format');

export const novelSlugParamSchema = z.object({
  slug: slugField,
});

export const chapterParamSchema = z.object({
  slug: slugField,
  chapterSlug: slugField.max(60, 'Chapter slug is too long'),
});

/**
 * Query của GET /api/novels.
 *
 * Hiện frontend lọc phía client (DiscoverView.tsx:16-24, SearchModal.tsx:21-28)
 * nên mọi tham số đều optional và mặc định là trả toàn bộ — giữ nguyên hành vi
 * đang có (quyết định Q2). Các tham số này để dành cho lúc dữ liệu lớn lên.
 */
export const novelQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  genre: z.string().trim().min(1).max(60).optional(),
  status: z.enum(['Ongoing', 'Completed', 'Hiatus']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * Body của PUT /api/novels/:slug/chapters/:chapterSlug/progress.
 *
 * `progress` optional vì App.handleReadChapter (App.tsx:57-83) đánh dấu chương
 * đã đọc mà KHÔNG hề tính phần trăm — không có dòng code nào ghi
 * `lastReadProgress`. Khi vắng mặt, service giữ nguyên giá trị cũ.
 */
export const progressSchema = z.object({
  progress: z.coerce.number().int().min(0).max(100).optional(),
});

export const groupSlugParamSchema = z.object({
  slug: slugField.max(120, 'Group slug is too long'),
});

export type NovelQueryInput = z.infer<typeof novelQuerySchema>;
export type ProgressInput = z.infer<typeof progressSchema>;