/**
 * Lưu response API thật thành fixture để test offline.
 *
 *   node scripts/capture-api-fixtures.mjs
 *
 * Cùng vai trò với fixture HTML của NovelUpdates: cho phép test toàn bộ tầng
 * normalize mà không cần mạng, và khi nguồn đổi shape thì chỉ cần chạy lại script
 * này là biết ngay chỗ nào gãy.
 *
 * Gửi rất ít request, có nghỉ giữa các lần.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = 'https://www.scribblehub.com/wp-json/fictionapp/v1';
const UA = 'LumiereBot/0.1 (+contact@example.com)';
const OUT = join(process.cwd(), 'tests', 'fixtures', 'scribblehub');

async function get(path) {
  const response = await fetch(BASE + path, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  return response.json();
}

await mkdir(OUT, { recursive: true });

async function capture(name, path) {
  const data = await get(path);
  await writeFile(join(OUT, `${name}.json`), JSON.stringify(data, null, 2), 'utf8');
  console.log(`✅ ${name}.json  <-  ${path}`);
  await sleep(2500);
  return data;
}

// Nguồn cho mode `latest` — endpoint quan trọng nhất, chạy 6 giờ/lần.
const updates = await capture('updates', '/updates?per_page=5');

// Nguồn cho mode `discover`.
const stories = await capture('stories', '/stories?per_page=3');

/*
 * Lấy chi tiết của MỘT truyện lấy từ danh sách trên, thay vì hardcode id.
 * Hardcode id sẽ khiến script hỏng khi truyện đó bị xoá.
 */
const list = Array.isArray(stories) ? stories : (stories.items ?? stories.data ?? []);
const sample = Array.isArray(list) ? list[0] : null;

if (sample?.id !== undefined) {
  await capture('story-detail', `/stories/${sample.id}`);
  await capture('story-chapters', `/stories/${sample.id}/chapters?per_page=5`);
  console.log(`\nTruyen mau: ${sample.title} (id=${sample.id})`);
} else {
  console.warn('⚠️  Khong lay duoc id truyen mau tu /stories — bo qua fixture chi tiet.');
}

const updateItems = Array.isArray(updates) ? updates : (updates.items ?? []);
console.log(`\nDa luu fixture vao ${OUT}`);
console.log(`  updates: ${Array.isArray(updateItems) ? updateItems.length : '?'} item`);
