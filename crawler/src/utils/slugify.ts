import { createHash } from 'node:crypto';

/**
 * Sinh slug an toàn cho database.
 *
 * ⚠️ Kết quả PHẢI thoả CHECK constraint đang có ở schema:
 *       slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
 * (novels.slug, chapters.slug, tags.slug, sources.slug, translation_groups.slug)
 *
 * Nghĩa là: chỉ a-z 0-9 và dấu gạch nối ĐƠN ở giữa, không gạch đầu/cuối, không
 * được rỗng. Slug sai định dạng sẽ làm INSERT fail giữa lúc import.
 */

const DEFAULT_MAX_LENGTH = 160;

export interface SlugifyOptions {
  maxLength?: number;
  /** Dùng khi chuỗi đầu vào không còn ký tự hợp lệ nào (VD tiêu đề toàn tiếng Nhật). */
  fallbackSeed?: string;
}

export function slugify(input: string, options: SlugifyOptions = {}): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;

  const slug = input
    // Tách dấu khỏi chữ cái rồi bỏ dấu: 'Café' -> 'Cafe'
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Nháy đơn/cong bị XOÁ chứ không thành gạch nối: "Hero's" -> 'heros', không phải 'hero-s'
    .replace(/['‘’ʼ]/g, '')
    // Mọi thứ còn lại không phải a-z0-9 thành gạch nối
    .replace(/[^a-z0-9]+/g, '-')
    // Gộp gạch nối liên tiếp
    .replace(/-+/g, '-')
    // Bỏ gạch nối đầu/cuối
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    // slice có thể để lại gạch nối ở cuối
    .replace(/-$/g, '');

  if (slug.length > 0) return slug;

  /*
   * Không còn ký tự latin nào — thường gặp với tiêu đề gốc tiếng Nhật/Trung/Hàn.
   * Trả chuỗi rỗng sẽ làm vi phạm CHECK, nên sinh slug ổn định từ hàm băm:
   * cùng đầu vào luôn cho cùng slug, nên chạy lại crawler không tạo bản trùng.
   */
  const seed = options.fallbackSeed ?? input;
  const digest = createHash('sha1').update(seed, 'utf8').digest('hex').slice(0, 12);
  return `item-${digest}`;
}

/**
 * Slug cho chương, phản ánh cấu trúc của D1.
 *
 *   { number: 243 }                        -> 'ch-243'
 *   { number: 243, volume: 5 }             -> 'v5-ch-243'
 *   { number: 243, part: 5 }               -> 'ch-243-5'
 *   { number: 12,  isExtra: true }         -> 'extra-ch-12'
 *   { number: 243, volume: 5, part: 2 }    -> 'v5-ch-243-2'
 *
 * Slug là ĐỊNH DANH của chương — UNIQUE (novel_id, slug). Nó phải phân biệt được
 * mọi biến thể, nếu không 'Chapter 12' và 'Extra Chapter 12' sẽ đè lên nhau.
 */
export interface ChapterSlugInput {
  number: number;
  volumeNumber?: number | null;
  partNumber?: number | null;
  isExtra?: boolean;
}

export function chapterSlug(input: ChapterSlugInput): string {
  const parts: string[] = [];

  if (input.isExtra === true) parts.push('extra');
  if (input.volumeNumber !== null && input.volumeNumber !== undefined) {
    parts.push(`v${input.volumeNumber}`);
  }
  parts.push(`ch-${input.number}`);
  if (input.partNumber !== null && input.partNumber !== undefined) {
    parts.push(String(input.partNumber));
  }

  // Đi qua slugify để chắc chắn thoả CHECK, dù input đã sạch.
  return slugify(parts.join('-'), { maxLength: 60 });
}
