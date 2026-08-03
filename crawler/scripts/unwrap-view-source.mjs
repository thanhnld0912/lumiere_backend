/**
 * Gỡ lớp bọc của trang `view-source:` đã lưu, trả về HTML gốc.
 *
 *   node scripts/unwrap-view-source.mjs tests/fixtures/novelupdates
 *
 * Khi lưu `view-source:` từ Chrome, HTML thật bị bọc trong bảng tô màu cú pháp:
 *
 *     <td class="line-content"><span class="html-tag">&lt;head&gt;</span></td>
 *
 * Script này lấy lại từng dòng nguồn: bỏ thẻ tô màu, giải mã entity, ghép lại
 * theo thứ tự dòng.
 *
 * Vì sao vẫn dùng được (thậm chí tốt): `view-source:` hiển thị RESPONSE THÔ từ
 * server — đúng thứ CheerioCrawler nhận. Bản "Save page" của trình duyệt thì lại
 * là DOM sau khi JavaScript chạy, có thể khác.
 *
 * Idempotent: file đã là HTML thường thì bỏ qua, không đụng tới.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const LINE_CELL_RE = /<td class="line-content"[^>]*>([\s\S]*?)<\/td>/g;
const TAG_RE = /<[^>]*>/g;

/** Giải mã entity. `&amp;` PHẢI xử lý cuối, nếu không sẽ giải mã hai lần. */
function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function isWrappedViewSource(html) {
  return html.includes('class="line-content"') && html.includes('class="line-number"');
}

function unwrap(html) {
  const lines = [];
  for (const match of html.matchAll(LINE_CELL_RE)) {
    lines.push(decodeEntities(match[1].replace(TAG_RE, '')));
  }
  return lines.join('\n');
}

const targetDir = resolve(process.cwd(), process.argv[2] ?? '.');
const files = (await readdir(targetDir)).filter((name) => name.endsWith('.html'));

if (files.length === 0) {
  console.error(`Không có file .html nào trong ${targetDir}`);
  process.exit(1);
}

let converted = 0;
let skipped = 0;

for (const name of files) {
  const path = join(targetDir, name);
  const original = await readFile(path, 'utf8');

  if (!isWrappedViewSource(original)) {
    console.log(`⏭  ${name} — đã là HTML thường, bỏ qua`);
    skipped += 1;
    continue;
  }

  const unwrapped = unwrap(original);

  // Kiểm tra tỉnh táo: kết quả phải trông như một trang HTML thật.
  const looksValid =
    unwrapped.length > 1000 &&
    /<html/i.test(unwrapped) &&
    /<\/html>/i.test(unwrapped);

  if (!looksValid) {
    console.error(
      `❌ ${name} — kết quả gỡ không giống HTML hợp lệ (${unwrapped.length} ký tự). ` +
        `Giữ nguyên file gốc.`,
    );
    continue;
  }

  await writeFile(path, unwrapped, 'utf8');
  const ratio = ((unwrapped.length / original.length) * 100).toFixed(0);
  console.log(
    `✅ ${name} — ${original.length.toLocaleString()} -> ${unwrapped.length.toLocaleString()} ký tự (${ratio}%)`,
  );
  converted += 1;
}

console.log(`\nĐã gỡ ${converted} file, bỏ qua ${skipped}.`);
