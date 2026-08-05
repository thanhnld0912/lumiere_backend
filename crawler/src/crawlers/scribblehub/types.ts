/**
 * Hình dạng response của ScribbleHub API.
 *
 * ⚠️ Toàn bộ kiểu dưới đây được XÁC MINH trên response thật lưu ở
 * tests/fixtures/scribblehub/, không phải suy đoán từ tài liệu.
 *
 * Khác hẳn nguồn HTML: dữ liệu đã CÓ KIỂU sẵn (số là số, ngày là ISO 8601), nên
 * không cần tầng `RawNovel` toàn string và không cần extractor phân tích chuỗi.
 */

/** Mọi endpoint đều bọc trong `{ data, meta }`. */
export interface ScribbleHubEnvelope<T> {
  readonly data: T;
  readonly meta?: ScribbleHubMeta;
}

export interface ScribbleHubMeta {
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface ScribbleHubAuthor {
  readonly id: number;
  readonly displayName: string;
  readonly username: string;
  readonly avatarUrl: string | null;
}

export interface ScribbleHubTerm {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
}

export interface ScribbleHubStory {
  readonly id: number;
  readonly title: string;
  /** VD '2441502-crimson-star' — có tiền tố id, và đã hợp lệ với CHECK slug của DB. */
  readonly slug: string;
  readonly author: ScribbleHubAuthor;
  readonly coverUrl: string | null;
  readonly description: string;
  /** Chữ thường, VD 'ongoing'. Xem mappings.ts. */
  readonly status: string;
  readonly genres: readonly ScribbleHubTerm[];
  readonly mainGenre: ScribbleHubTerm | null;
  readonly tags: readonly ScribbleHubTerm[];

  readonly ratingAverage: number;
  readonly ratingCount: number;

  /** ⭐ Lượt đọc THẬT — giải quyết quyết định D5, không cần chỉ số suy ra. */
  readonly readCount: number;
  readonly readersCount: number;
  readonly favoritesCount: number;

  readonly chapterCount: number;
  readonly wordCount: number;
  /** ISO 8601 có múi giờ. Nguồn cho `novels.last_chapter_at`. */
  readonly lastUpdated: string;
  readonly isMature: boolean;
  readonly isAccessible: boolean;

  /* ── Chỉ có ở /stories/{id}, KHÔNG có ở /stories ── */
  /** ⭐ Khớp thẳng `novels.release_rate_per_week` của D6 — không phải tự tính. */
  readonly chaptersPerWeek?: number;
  readonly firstChapterId?: number;
  readonly hasGlossary?: boolean;
}

export interface ScribbleHubChapter {
  readonly id: number;
  readonly storyId: number;
  readonly title: string;
  readonly number: number;
  /** Rỗng ở endpoint danh sách — hiện chưa crawl nội dung chương, đúng yêu cầu. */
  readonly content: string;
  readonly wordCount: number;
  readonly publishedAt: string;
  readonly previousChapterId: number | null;
  readonly nextChapterId: number | null;
}

/** Một dòng của /updates — gồm cả truyện lẫn chương mới nhất. */
export interface ScribbleHubUpdate {
  readonly story: ScribbleHubStory;
  readonly latestChapter: {
    readonly id: number;
    readonly title: string;
    readonly number: number;
    readonly publishedAt: string;
  };
}

/* ── Type guard: dữ liệu ngoài không được tin, phải kiểm tra trước khi dùng ── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isScribbleHubStory(value: unknown): value is ScribbleHubStory {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'number' &&
    typeof value['title'] === 'string' &&
    typeof value['slug'] === 'string'
  );
}

export function isScribbleHubChapter(value: unknown): value is ScribbleHubChapter {
  if (!isRecord(value)) return false;
  return (
    typeof value['id'] === 'number' &&
    typeof value['number'] === 'number' &&
    typeof value['title'] === 'string' &&
    typeof value['publishedAt'] === 'string'
  );
}

export function isScribbleHubUpdate(value: unknown): value is ScribbleHubUpdate {
  if (!isRecord(value)) return false;
  const chapter = value['latestChapter'];
  return (
    isScribbleHubStory(value['story']) &&
    isRecord(chapter) &&
    typeof chapter['number'] === 'number'
  );
}

/**
 * Bóc `{data, meta}` và kiểm tra từng phần tử.
 *
 * Phần tử sai hình dạng bị BỎ QUA thay vì làm hỏng cả trang — nhưng số lượng bị
 * bỏ được trả về để người gọi tính tỉ lệ schema drift.
 */
export function readEnvelope<T>(
  payload: unknown,
  isValid: (item: unknown) => item is T,
): { items: T[]; meta: ScribbleHubMeta | null; skipped: number } {
  if (!isRecord(payload) || !Array.isArray(payload['data'])) {
    return { items: [], meta: null, skipped: 0 };
  }

  const items: T[] = [];
  let skipped = 0;

  for (const raw of payload['data']) {
    if (isValid(raw)) items.push(raw);
    else skipped += 1;
  }

  const metaValue = payload['meta'];
  const meta =
    isRecord(metaValue) && typeof metaValue['totalPages'] === 'number'
      ? (metaValue as unknown as ScribbleHubMeta)
      : null;

  return { items, meta, skipped };
}
