/**
 * Làm sạch chuỗi lấy từ HTML.
 *
 * Hàm THUẦN — không I/O, không DOM. Test được hoàn toàn bằng unit test.
 */

/**
 * Ký tự vô hình hay lẫn trong HTML và làm hỏng so sánh chuỗi lẫn hàm băm nội dung.
 * Nếu không bỏ chúng, hai chuỗi trông y hệt nhau sẽ cho ra content_hash khác
 * nhau và crawler báo "đã thay đổi" ở mọi lần chạy.
 */
const INVISIBLE_CHARS = /[​-‍⁠﻿]/g;

/** Non-breaking space và họ hàng — trông như dấu cách nhưng không phải \s trong một số engine. */
const EXOTIC_SPACES = /[   -   　]/g;

/**
 * Cheerio đã giải mã entity, nhưng nguồn thỉnh thoảng có entity bị mã hoá hai
 * lần (`&amp;amp;`). Chỉ xử lý nhóm phổ biến — không viết lại cả bộ giải mã HTML.
 */
const HTML_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&apos;', "'"],
  ['&nbsp;', ' '],
  ['&hellip;', '…'],
  ['&mdash;', '—'],
  ['&ndash;', '–'],
  ['&rsquo;', '’'],
  ['&lsquo;', '‘'],
  ['&rdquo;', '”'],
  ['&ldquo;', '“'],
]);

/**
 * Giá trị placeholder mà nguồn dùng để nói "không có dữ liệu".
 * Coi chúng là null thay vì lưu nguyên văn chuỗi 'N/A' vào database.
 */
const NULL_TOKENS: ReadonlySet<string> = new Set([
  'n/a',
  'na',
  '-',
  '--',
  '—',
  'none',
  'unknown',
  'null',
  'undefined',
  'tbd',
  '?',
]);

export function decodeEntities(input: string): string {
  let output = input;
  for (const [entity, char] of HTML_ENTITIES) {
    output = output.split(entity).join(char);
  }
  return output;
}

/**
 * Chuẩn hoá một chuỗi lấy từ HTML.
 *
 *   cleanText('  Shadow of   the​ Void \n ')  ->  'Shadow of the Void'
 *   cleanText('N/A')                                    ->  null
 *   cleanText('   ')                                    ->  null
 */
export function cleanText(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;

  const cleaned = decodeEntities(input)
    .replace(INVISIBLE_CHARS, '')
    .replace(EXOTIC_SPACES, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length === 0) return null;
  if (NULL_TOKENS.has(cleaned.toLowerCase())) return null;

  return cleaned;
}

/** Như `cleanText` nhưng trả chuỗi rỗng thay vì null — dùng cho cột NOT NULL. */
export function cleanTextOrEmpty(input: string | null | undefined): string {
  return cleanText(input) ?? '';
}

/**
 * Giữ ngắt đoạn nhưng vẫn gom whitespace trong từng đoạn.
 * Dùng cho synopsis — nếu ép hết về một dòng thì mất cấu trúc bài viết.
 */
export function cleanMultilineText(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;

  const paragraphs = decodeEntities(input)
    .replace(INVISIBLE_CHARS, '')
    .replace(EXOTIC_SPACES, ' ')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length === 0) return null;
  return paragraphs.join('\n\n');
}

/**
 * Bỏ tiền tố nhãn mà nguồn hay gắn trước giá trị.
 *
 *   stripLabel('Author: Aris Thorne', ['Author'])  ->  'Aris Thorne'
 *   stripLabel('Type - Web Novel', ['Type'])       ->  'Web Novel'
 */
export function stripLabel(input: string, labels: readonly string[]): string {
  let output = input.trim();
  for (const label of labels) {
    const pattern = new RegExp(`^\\s*${escapeRegExp(label)}\\s*[:：\\-–—]\\s*`, 'i');
    if (pattern.test(output)) {
      output = output.replace(pattern, '');
      break;
    }
  }
  return output.trim();
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
