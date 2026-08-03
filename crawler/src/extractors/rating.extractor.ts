import { clamp, parseFloatSafe, parseIntSafe } from './number.extractor.js';
import { cleanText } from './text.extractor.js';

/**
 * Bóc điểm đánh giá và số phiếu. Hàm THUẦN.
 *
 * Định dạng gặp thực tế:
 *   '4.2 / 5 from 1,234 ratings'
 *   '(4.2 / 5.0, 1234 votes)'
 *   'Rating: 4.2/5'
 *   '8.4 / 10'            <- thang khác, phải quy đổi
 *   '4.2'
 */

export interface ExtractedRating {
  /** Đã quy về thang 5 và kẹp vào [0, 5] cho khớp CHECK của cột numeric(3,2). */
  readonly rating: number | null;
  readonly ratingsCount: number | null;
  /** Thang gốc phát hiện được — giữ lại để debug khi số trông sai. */
  readonly detectedScale: number;
}

const EMPTY: ExtractedRating = { rating: null, ratingsCount: null, detectedScale: 5 };

/** 'X / Y' hoặc 'X/Y' */
const SCALED_RE = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/;

/** Số phiếu kèm danh từ. Danh từ là bắt buộc để không bắt nhầm chính điểm số. */
const COUNT_WITH_NOUN_RE = /(\d[\d,  '’]*)\s*(?:vote|rating|user|review|reader)s?\b/i;

/** 'from 1,234' — NovelUpdates hay viết kiểu này, không có danh từ theo sau. */
const COUNT_FROM_RE = /\bfrom\s+(\d[\d,  '’]*)/i;

export function extractRating(input: string | null | undefined): ExtractedRating {
  const text = cleanText(input);
  if (text === null) return EMPTY;

  let rating: number | null = null;
  let detectedScale = 5;

  const scaled = SCALED_RE.exec(text);
  if (scaled?.[1] !== undefined && scaled[2] !== undefined) {
    const value = parseFloatSafe(scaled[1]);
    const scale = parseFloatSafe(scaled[2]);

    if (value !== null && scale !== null && scale > 0) {
      detectedScale = scale;
      /*
       * Quy về thang 5 vì cột là numeric(3,2) với CHECK (rating BETWEEN 0 AND 5).
       * Nguồn dùng thang 10 mà không quy đổi thì mọi INSERT sẽ vi phạm CHECK.
       */
      rating = scale === 5 ? value : (value / scale) * 5;
    }
  } else {
    /*
     * Không có thang -> giả định thang 5. Đây là suy đoán, nhưng an toàn:
     * giá trị bị kẹp về [0,5] ngay bên dưới nên không bao giờ phá CHECK.
     */
    rating = parseFloatSafe(text);
  }

  const countMatch = COUNT_WITH_NOUN_RE.exec(text) ?? COUNT_FROM_RE.exec(text);
  const ratingsCount = countMatch?.[1] !== undefined ? parseIntSafe(countMatch[1]) : null;

  return {
    // Làm tròn 2 chữ số cho khớp numeric(3,2) — nếu không Postgres tự làm tròn
    // và giá trị đọc lại sẽ khác giá trị vừa ghi.
    rating: rating === null ? null : roundTo(clamp(rating, 0, 5) ?? 0, 2),
    ratingsCount: ratingsCount !== null && ratingsCount >= 0 ? ratingsCount : null,
    detectedScale,
  };
}

/**
 * Khi điểm và số phiếu nằm ở hai chỗ khác nhau trên trang — trường hợp phổ biến
 * hơn là cả hai nằm chung một chuỗi.
 */
export function extractRatingParts(
  ratingText: string | null | undefined,
  countText: string | null | undefined,
): ExtractedRating {
  const fromRating = extractRating(ratingText);
  const count = parseIntSafe(cleanText(countText));

  return {
    rating: fromRating.rating,
    ratingsCount: count !== null && count >= 0 ? count : fromRating.ratingsCount,
    detectedScale: fromRating.detectedScale,
  };
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
