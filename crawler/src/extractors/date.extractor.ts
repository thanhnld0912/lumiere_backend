import { parseIntSafe } from './number.extractor.js';
import { cleanText } from './text.extractor.js';

/**
 * Đổi chuỗi thời gian sang Date. Hàm THUẦN.
 *
 * ⚠️ `now` là THAM SỐ chứ không gọi `new Date()` bên trong. Nếu không, hàm phụ
 * thuộc đồng hồ hệ thống và không thể viết test tất định cho '2 days ago'.
 *
 * Định dạng gặp thực tế:
 *   '2 hours ago'   '3 days ago'   'an hour ago'   'yesterday'
 *   '10/12/23'      'Oct 12, 2023' '2023-10-12'
 */

const MS = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000, // 30 ngày — xấp xỉ, đủ dùng cho nhãn tương đối
  year: 31_536_000_000, // 365 ngày
} as const;

type Unit = keyof typeof MS;

const UNIT_ALIASES: ReadonlyMap<string, Unit> = new Map([
  ['sec', 'second'],
  ['secs', 'second'],
  ['second', 'second'],
  ['seconds', 'second'],
  ['min', 'minute'],
  ['mins', 'minute'],
  ['minute', 'minute'],
  ['minutes', 'minute'],
  ['hr', 'hour'],
  ['hrs', 'hour'],
  ['hour', 'hour'],
  ['hours', 'hour'],
  ['day', 'day'],
  ['days', 'day'],
  ['week', 'week'],
  ['weeks', 'week'],
  ['wk', 'week'],
  ['wks', 'week'],
  ['month', 'month'],
  ['months', 'month'],
  ['mo', 'month'],
  ['mos', 'month'],
  ['year', 'year'],
  ['years', 'year'],
  ['yr', 'year'],
  ['yrs', 'year'],
]);

/** '2 days ago', 'an hour ago', '3 mins ago'. */
const RELATIVE_RE = /^(?:(\d+)|an?)\s*([a-z]+)\s*ago$/i;

/** '10/12/23' hoặc '10/12/2023'. */
const SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

/** 'Oct 12, 2023' */
const MONTH_FIRST_RE = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i;
/** '12 Oct 2023' */
const DAY_FIRST_NAME_RE = /^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})$/i;

/**
 * ISO 8601. CHỈ dạng này mới được giao cho `new Date()`.
 *
 * Lý do giới hạn: `new Date('02/31/23')` không báo lỗi mà lặng lẽ cuộn sang
 * 03/03, và parse theo GIỜ ĐỊA PHƯƠNG — nên kết quả khác nhau giữa máy dev
 * (UTC+7) và runner CI (UTC). Dạng ISO chỉ-ngày thì spec quy định là UTC nên an toàn.
 */
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const MONTH_NAMES: ReadonlyMap<string, number> = new Map(
  [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ].map((name, index) => [name, index]),
);

export interface ParseDateOptions {
  /**
   * Thứ tự ngày/tháng của dạng 'A/B/C'.
   *
   * NovelUpdates là site Mỹ nên mặc định MM/DD/YY. Đây là một GIẢ ĐỊNH: với
   * '10/12/23' thì không có cách nào biết chắc là 10 tháng 12 hay 12 tháng 10.
   * Nguồn nào dùng DD/MM thì khai báo lại trong config của nguồn đó.
   */
  readonly dayFirst?: boolean;
}

/**
 * Trả null khi không nhận dạng được, thay vì Invalid Date.
 * Invalid Date lọt xuống Postgres sẽ thành lỗi khó truy ở tận tầng insert.
 */
export function parseDate(
  input: string | null | undefined,
  now: Date,
  options: ParseDateOptions = {},
): Date | null {
  const text = cleanText(input);
  if (text === null) return null;

  const lower = text.toLowerCase();

  if (lower === 'today' || lower === 'just now' || lower === 'now') {
    return new Date(now.getTime());
  }
  if (lower === 'yesterday') {
    return new Date(now.getTime() - MS.day);
  }

  const relative = parseRelative(lower, now);
  if (relative !== null) return relative;

  /*
   * QUAN TRỌNG: khi chuỗi KHỚP một định dạng ta xử lý nhưng giá trị không hợp lệ
   * (VD '02/31/23'), phải trả null NGAY — tuyệt đối không rơi xuống fallback.
   *
   * Trước đây có bug đúng chỗ này: parseSlashDate từ chối đúng ngày 31/02, rồi
   * `new Date('02/31/23')` ở cuối lại "parse thành công" bằng cách cuộn sang
   * 03/03 theo giờ địa phương. Kết quả vừa sai ngày vừa lệch múi giờ giữa máy
   * dev và CI.
   */
  if (SLASH_DATE_RE.test(text)) {
    return parseSlashDate(text, options.dayFirst === true);
  }

  if (MONTH_FIRST_RE.test(text) || DAY_FIRST_NAME_RE.test(text)) {
    return parseMonthNameDate(text);
  }

  if (ISO_RE.test(text)) {
    const iso = new Date(text);
    return Number.isNaN(iso.getTime()) ? null : iso;
  }

  return null;
}

function parseRelative(lower: string, now: Date): Date | null {
  const match = RELATIVE_RE.exec(lower);
  if (!match?.[2]) return null;

  const unit = UNIT_ALIASES.get(match[2]);
  if (!unit) return null;

  // 'an hour ago' / 'a day ago' -> không có nhóm số, hiểu là 1.
  const amount = match[1] !== undefined ? (parseIntSafe(match[1]) ?? 1) : 1;

  return new Date(now.getTime() - amount * MS[unit]);
}

function parseSlashDate(text: string, dayFirst: boolean): Date | null {
  const match = SLASH_DATE_RE.exec(text);
  if (!match?.[1] || !match[2] || !match[3]) return null;

  const first = Number.parseInt(match[1], 10);
  const second = Number.parseInt(match[2], 10);
  let year = Number.parseInt(match[3], 10);

  // Năm 2 chữ số: '99' -> 1999, '23' -> 2023. Mốc 70 là quy ước POSIX.
  if (match[3].length === 2) year += year >= 70 ? 1900 : 2000;

  let month = dayFirst ? second : first;
  let day = dayFirst ? first : second;

  /*
   * Tự sửa khi giá trị bất khả thi: '25/12/23' không thể là tháng 25, nên chắc
   * chắn là DD/MM dù config nói MM/DD. Cứu được dữ liệu thay vì trả null.
   */
  if (month > 12 && day <= 12) {
    [month, day] = [day, month];
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return buildUtcDate(year, month - 1, day);
}

function parseMonthNameDate(text: string): Date | null {
  const match = MONTH_FIRST_RE.exec(text);
  const reversed = DAY_FIRST_NAME_RE.exec(text);

  const parts = match
    ? { monthName: match[1], day: match[2], year: match[3] }
    : reversed
      ? { monthName: reversed[2], day: reversed[1], year: reversed[3] }
      : null;

  if (!parts?.monthName || !parts.day || !parts.year) return null;

  const month = MONTH_NAMES.get(parts.monthName.slice(0, 3).toLowerCase());
  if (month === undefined) return null;

  const day = Number.parseInt(parts.day, 10);
  const year = Number.parseInt(parts.year, 10);
  if (day < 1 || day > 31) return null;

  return buildUtcDate(year, month, day);
}

/**
 * Dựng ngày ở UTC. Cột là `timestamptz` và Postgres lưu theo UTC — dùng giờ địa
 * phương sẽ khiến ngày lệch một đơn vị giữa máy dev và runner CI (chạy UTC).
 */
function buildUtcDate(year: number, monthIndex: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, monthIndex, day));
  // Bắt ngày không tồn tại như 31/02 — Date tự cuộn sang tháng sau.
  if (date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return null;
  return date;
}
