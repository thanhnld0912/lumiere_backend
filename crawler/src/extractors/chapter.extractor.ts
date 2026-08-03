import { parseIntSafe } from './number.extractor.js';
import { cleanText } from './text.extractor.js';

/**
 * Bóc nhãn chương thành các thành phần có cấu trúc — phần khó nhất của crawler.
 *
 * Đây chính là quyết định D1: KHÔNG hardcode 'Chapter 243', mà tách thành
 * number / volume / part / isExtra / title, giữ nguyên chuỗi gốc.
 *
 * Định dạng gặp thực tế trên NovelUpdates:
 *   c243            v2c15           c243.5          c243 part2
 *   Chapter 243     Vol 5 Chapter 243               Chapter 243: Return
 *   Extra Chapter 12                ss1             c100-102
 *   Prologue        Epilogue        Afterword       Interlude 3
 *
 * Hàm THUẦN — test được toàn bộ, không cần mạng.
 */

export interface ExtractedChapterLabel {
  /** Null khi nhãn không có số nào (VD 'Prologue'). Normalizer phải xử lý ca này. */
  readonly number: number | null;
  readonly volumeNumber: number | null;
  /** Từ 'c243.5' hoặc 'part 2'. */
  readonly partNumber: number | null;
  readonly isExtra: boolean;
  /** CHỈ tên riêng, VD 'Return'. Rỗng khi nguồn không đặt tên — KHÔNG bịa. */
  readonly title: string;
  /** Từ 'c100-102' -> 102. Một nhãn gộp nhiều chương. */
  readonly rangeEnd: number | null;
  /** Chuỗi gốc đã làm sạch — lưu vào chapters.raw_title để re-parse sau. */
  readonly raw: string;
}

const EMPTY = (raw: string): ExtractedChapterLabel => ({
  number: null,
  volumeNumber: null,
  partNumber: null,
  isExtra: false,
  title: '',
  rangeEnd: null,
  raw,
});

/*
 * Lookbehind (?<![a-z]) là mấu chốt: nếu không có nó, chữ 'c' hoặc 'v' đứng
 * giữa một từ bình thường sẽ bị hiểu nhầm thành ký hiệu chương/tập.
 * Thứ tự nhánh trong alternation cũng quan trọng — 'chapters?' phải đứng trước
 * 'ch' và 'c', nếu không 'Chapter 243' sẽ khớp mỗi chữ 'c'.
 */
const VOLUME_RE = /(?<![a-z])(?:volumes?|vols?|v)\.?\s*(\d+)/i;
const CHAPTER_RE = /(?<![a-z])(?:chapters?|chaps?|chs?|c)\.?\s*(\d+)(?:\.(\d+))?/i;
const BARE_NUMBER_RE = /^\s*(\d+)(?:\.(\d+))?\s*(?![\d.])/;
const PART_RE = /(?<![a-z])(?:parts?|pts?)\.?\s*(\d+)/i;
const RANGE_RE = /^\s*[-–—~]\s*(\d+)/;

/** 'ss1', 'ss 3' — side story có đánh số. Xử lý riêng vì \b không tách được 'ss1'. */
const SIDE_STORY_RE = /(?<![a-z])ss\.?\s*(\d+)?/i;

/**
 * Dấu hiệu chương phụ. Ảnh hưởng trực tiếp tới `sort_index`: extra được xếp
 * NGAY SAU chương thường cùng số.
 */
const EXTRA_RE =
  /(?<![a-z])(extras?|side\s*stor(?:y|ies)|specials?|omake|bonus|interludes?|epilogues?|prologues?|afterwords?|prefaces?|intermissions?)(?![a-z])/i;

/** Ký tự phân cách giữa phần số và phần tên. */
const LEADING_SEPARATORS = /^[\s:：\-–—,.|]+/;
const TRAILING_SEPARATORS = /[\s:：\-–—,.|]+$/;

export function extractChapterLabel(
  input: string | null | undefined,
): ExtractedChapterLabel {
  const raw = cleanText(input);
  if (raw === null) return EMPTY('');

  /*
   * Tách phần CẤU TRÚC khỏi phần TÊN tại dấu hai chấm đầu tiên.
   *
   * Bắt buộc phải làm, nếu không 'Chapter 5: Special Delivery' sẽ bị nhận nhầm
   * là chương phụ chỉ vì chữ 'Special' nằm trong tên — và isExtra sai sẽ làm
   * sai luôn sort_index, tức sai thứ tự đọc.
   *
   * Giới hạn đã biết: tên chương có chứa dấu hai chấm ('Ch 5: Part 1: Mở đầu')
   * thì phần sau dấu hai chấm ĐẦU TIÊN được coi trọn vẹn là tên. Chấp nhận được
   * — hiếm gặp, và đoán sai theo hướng này thì vô hại.
   */
  const colonIndex = raw.search(/[:：]/);
  const head = colonIndex >= 0 ? raw.slice(0, colonIndex) : raw;
  const tail = colonIndex >= 0 ? raw.slice(colonIndex + 1) : null;

  let rest = head;

  /* 1. Chương phụ — phát hiện TRƯỚC khi bóc số, vì 'Extra Chapter 12' vẫn có số. */
  let isExtra = false;
  const extraMatch = EXTRA_RE.exec(rest);
  if (extraMatch) {
    isExtra = true;
    rest = removeMatch(rest, extraMatch);
  }

  /* 2. Side story dạng 'ss1' — cũng là extra, nhưng số nằm dính liền ký hiệu. */
  let sideStoryNumber: number | null = null;
  if (!isExtra) {
    const ssMatch = SIDE_STORY_RE.exec(rest);
    if (ssMatch) {
      isExtra = true;
      sideStoryNumber = ssMatch[1] !== undefined ? parseIntSafe(ssMatch[1]) : null;
      rest = removeMatch(rest, ssMatch);
    }
  }

  /* 3. Tập — PHẢI bóc trước chương, nếu không 'v2c15' sẽ bị đọc sai. */
  let volumeNumber: number | null = null;
  const volumeMatch = VOLUME_RE.exec(rest);
  if (volumeMatch?.[1] !== undefined) {
    volumeNumber = parseIntSafe(volumeMatch[1]);
    rest = removeMatch(rest, volumeMatch);
  }

  /* 4. Số chương, kèm phần thập phân ('c243.5' -> number 243, part 5). */
  let number: number | null = null;
  let partNumber: number | null = null;

  const chapterMatch = CHAPTER_RE.exec(rest);
  if (chapterMatch?.[1] !== undefined) {
    number = parseIntSafe(chapterMatch[1]);
    if (chapterMatch[2] !== undefined) partNumber = parseIntSafe(chapterMatch[2]);
    rest = removeMatch(rest, chapterMatch);
  } else {
    // Không có ký hiệu chương — thử số trần ở đầu chuỗi, VD '243: Return'.
    const bareMatch = BARE_NUMBER_RE.exec(rest);
    if (bareMatch?.[1] !== undefined) {
      number = parseIntSafe(bareMatch[1]);
      if (bareMatch[2] !== undefined) partNumber = parseIntSafe(bareMatch[2]);
      rest = removeMatch(rest, bareMatch);
    }
  }

  if (number === null && sideStoryNumber !== null) {
    number = sideStoryNumber;
  }

  /* 5. Khoảng chương ('c100-102'). Phải xét NGAY sau số chương. */
  let rangeEnd: number | null = null;
  const rangeMatch = RANGE_RE.exec(rest);
  if (rangeMatch?.[1] !== undefined && number !== null) {
    const end = parseIntSafe(rangeMatch[1]);
    // Chỉ nhận nếu thực sự là khoảng tăng dần; '-2' trong tiêu đề không phải range.
    if (end !== null && end > number) {
      rangeEnd = end;
      rest = removeMatch(rest, rangeMatch);
    }
  }

  /* 6. Phần ('part 2') — chỉ khi bước 4 chưa lấy được part từ dạng thập phân. */
  const partMatch = PART_RE.exec(rest);
  if (partMatch?.[1] !== undefined) {
    if (partNumber === null) partNumber = parseIntSafe(partMatch[1]);
    rest = removeMatch(rest, partMatch);
  }

  /*
   * 7. Tên chương.
   *
   * Có phần sau dấu hai chấm thì đó chính là tên. Không có thì lấy phần thừa
   * còn lại của head (VD 'c243 Awakening' -> 'Awakening').
   */
  const leftover = rest.replace(LEADING_SEPARATORS, '').replace(TRAILING_SEPARATORS, '').trim();
  const title = tail !== null ? tail.trim() : leftover;

  return {
    number,
    volumeNumber,
    partNumber,
    isExtra,
    title: normaliseTitle(title),
    rangeEnd,
    raw,
  };
}

/**
 * Ghép nhãn hiển thị đầy đủ từ các thành phần.
 *
 * Đây là nguồn cho `chapters.display_title`. Chỉ dùng dữ liệu THẬT: nguồn không
 * đặt tên chương thì nhãn dừng ở số, không thêm chữ nào.
 *
 *   { number: 243 }                        -> 'Chapter 243'
 *   { number: 243, title: 'Return' }       -> 'Chapter 243: Return'
 *   { number: 243, volumeNumber: 5 }       -> 'Vol 5 Chapter 243'
 *   { number: 243, partNumber: 2 }         -> 'Chapter 243 Part 2'
 *   { number: 12, isExtra: true }          -> 'Extra Chapter 12'
 *   { number: null, title: 'Prologue' }    -> 'Prologue'
 */
export function buildDisplayTitle(parts: ExtractedChapterLabel): string {
  const segments: string[] = [];

  if (parts.volumeNumber !== null) segments.push(`Vol ${parts.volumeNumber}`);

  if (parts.number !== null) {
    const prefix = parts.isExtra ? 'Extra Chapter' : 'Chapter';
    let chapterSegment = `${prefix} ${parts.number}`;
    if (parts.rangeEnd !== null) chapterSegment += `-${parts.rangeEnd}`;
    if (parts.partNumber !== null) chapterSegment += ` Part ${parts.partNumber}`;
    segments.push(chapterSegment);
  }

  const head = segments.join(' ');

  if (head.length === 0) {
    // Không có số nào — dùng chính chuỗi gốc, VD 'Prologue'.
    return parts.title.length > 0 ? parts.title : parts.raw;
  }

  return parts.title.length > 0 ? `${head}: ${parts.title}` : head;
}

function removeMatch(text: string, match: RegExpExecArray): string {
  return text.slice(0, match.index) + text.slice(match.index + match[0].length);
}

/**
 * Chuỗi còn lại đôi khi chỉ là rác ('v', 'c', dấu câu lẻ). Coi những thứ đó là
 * không có tên, thay vì lưu ký tự vô nghĩa vào cột title.
 */
function normaliseTitle(title: string): string {
  const cleaned = cleanText(title);
  if (cleaned === null) return '';
  if (cleaned.length <= 1 && !/[a-z0-9]/i.test(cleaned)) return '';
  return cleaned;
}
