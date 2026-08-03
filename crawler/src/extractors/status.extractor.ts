import { parseIntSafe } from './number.extractor.js';
import { cleanText } from './text.extractor.js';

/**
 * Bóc trạng thái và tổng số chương. Hàm THUẦN.
 *
 * ⚠️ Extractor này CỐ Ý KHÔNG map sang enum `novel_status`.
 *
 * Nó chỉ tách CẤU TRÚC ('Completed (243 chapters)' -> token 'Completed' + số 243).
 * Việc ánh xạ token sang vựng từ của Lumiere là của normalizer, dùng bảng
 * mapping riêng của từng nguồn. Tách như vậy thì khi một site đổi CÁCH VIẾT
 * trạng thái, chỉ bảng mapping phải sửa — extractor và parser giữ nguyên.
 *
 * Định dạng gặp thực tế trên NovelUpdates:
 *   'Completed'
 *   '243 Chapters (Completed)'
 *   'Completed (243 chapters)'
 *   'Ongoing'
 *   '156 Chapters (Ongoing)'
 *   'Hiatus'
 *   '12 Volumes (Completed)'
 */

export interface ExtractedStatus {
  /** Token trạng thái nguyên trạng, VD 'Completed'. Null nếu không tìm thấy. */
  readonly statusText: string | null;
  readonly totalChapters: number | null;
  readonly totalVolumes: number | null;
}

const EMPTY: ExtractedStatus = { statusText: null, totalChapters: null, totalVolumes: null };

/** 'N Chapters' / 'N chapter' / 'N ch' */
const CHAPTERS_RE = /(\d[\d,  ]*)\s*(?:chapters?|chs?\b|eps?\b|episodes?)/i;

/** 'N Volumes' / 'N vols' */
const VOLUMES_RE = /(\d[\d,  ]*)\s*(?:volumes?|vols?\b)/i;

/** Nội dung trong ngoặc, VD '(Completed)'. */
const PARENTHESES_RE = /\(([^)]+)\)/;

/**
 * Các token trạng thái đã biết. Danh sách này KHÔNG phải bảng mapping — nó chỉ
 * dùng để NHẬN RA đâu là phần trạng thái trong chuỗi hỗn hợp.
 */
const STATUS_TOKENS: readonly string[] = [
  'completed',
  'complete',
  'ongoing',
  'on-going',
  'hiatus',
  'on hiatus',
  'dropped',
  'discontinued',
  'cancelled',
  'canceled',
  'abandoned',
  'stalled',
  'paused',
  'unknown',
];

export function extractStatus(input: string | null | undefined): ExtractedStatus {
  const text = cleanText(input);
  if (text === null) return EMPTY;

  const totalChapters = extractCount(text, CHAPTERS_RE);
  const totalVolumes = extractCount(text, VOLUMES_RE);

  return {
    statusText: findStatusToken(text),
    totalChapters,
    totalVolumes,
  };
}

function extractCount(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  if (match?.[1] === undefined) return null;

  const value = parseIntSafe(match[1]);
  // Số âm hoặc 0 chương là vô nghĩa; và CHECK ở DB yêu cầu >= 0.
  return value !== null && value > 0 ? value : null;
}

/**
 * Tìm phần trạng thái trong chuỗi.
 *
 * Ưu tiên nội dung trong ngoặc: '243 Chapters (Completed)' thì phần trong ngoặc
 * gần như luôn là trạng thái, còn phần ngoài là số lượng.
 */
function findStatusToken(text: string): string | null {
  const parenthesised = PARENTHESES_RE.exec(text);
  if (parenthesised?.[1] !== undefined) {
    const inner = cleanText(parenthesised[1]);
    if (inner !== null && matchesKnownToken(inner)) {
      return inner;
    }
  }

  // Không có ngoặc: quét cả chuỗi tìm token đã biết.
  const lower = text.toLowerCase();
  for (const token of STATUS_TOKENS) {
    const pattern = new RegExp(`\\b${token.replace(/[-\s]/g, '[-\\s]')}\\b`, 'i');
    const match = pattern.exec(lower);
    if (match) {
      // Trả về đúng đoạn văn bản GỐC (giữ nguyên hoa thường của nguồn),
      // không trả về token trong danh sách.
      return text.slice(match.index, match.index + match[0].length);
    }
  }

  /*
   * Không nhận ra token nào. Trả nguyên chuỗi đã làm sạch thay vì null: bảng
   * mapping của nguồn có thể biết giá trị này, và nếu không thì nó ghi log
   * "chưa map được: X" — hữu ích hơn nhiều so với việc mất trắng thông tin.
   */
  return text;
}

function matchesKnownToken(value: string): boolean {
  const normalised = value.toLowerCase().trim();
  return STATUS_TOKENS.some((token) => normalised === token || normalised.includes(token));
}
