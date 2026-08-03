import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import type { ParseContext } from '../../src/core/contracts/IParser.js';
import type { CheerioRoot } from '../../src/parsers/types.js';

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

interface ManifestEntry {
  file: string;
  kind: string;
  url: string;
  externalId?: string;
  present: boolean;
}

interface Manifest {
  source: string;
  baseUrl: string;
  fixtures: ManifestEntry[];
}

/**
 * URL gốc lấy từ manifest.json, KHÔNG hardcode trong test.
 *
 * Parser dùng `ParseContext.url` để resolve link tương đối và tách external_id,
 * nên URL sai sẽ làm test qua trong khi parser thật vẫn hỏng.
 */
export function loadManifest(source: string): Manifest {
  const path = join(FIXTURE_ROOT, source, 'manifest.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

export function fixtureEntry(source: string, file: string): ManifestEntry {
  const entry = loadManifest(source).fixtures.find((item) => item.file === file);
  if (!entry) {
    throw new Error(`Không có mục '${file}' trong manifest của '${source}'`);
  }
  return entry;
}

/** Nạp fixture và trả về sẵn `$` cùng ParseContext dựng từ manifest. */
export function loadFixture(
  source: string,
  file: string,
): { $: CheerioRoot; ctx: ParseContext; entry: ManifestEntry } {
  const entry = fixtureEntry(source, file);
  const html = readFileSync(join(FIXTURE_ROOT, source, file), 'utf8');

  return {
    /*
     * Ép kiểu là CẦN THIẾT, không phải né lỗi lười.
     *
     * `cheerio` xuất bản hai file khai báo riêng cho CJS (`lib/load`) và ESM
     * (`lib/esm/load`). Crawlee biên dịch ở chế độ CJS nên `$` của nó mang kiểu
     * thứ nhất, còn `import from 'cheerio'` trong package ESM này lại ra kiểu
     * thứ hai. Về runtime chúng là CÙNG MỘT object — chỉ TypeScript coi là khác.
     *
     * Ép ở đúng MỘT chỗ này (code test) để toàn bộ src/ không phải đụng tới.
     * Xem src/parsers/types.ts.
     */
    $: cheerio.load(html) as unknown as CheerioRoot,
    ctx: { url: entry.url, sourceId: source },
    entry,
  };
}
