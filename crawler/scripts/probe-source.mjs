/**
 * Thăm dò khả năng truy cập của một nguồn — chạy TRƯỚC khi viết adapter.
 *
 *   node scripts/probe-source.mjs https://www.novelupdates.com
 *
 * Trả lời ba câu hỏi mà chỉ nhìn code không biết được:
 *   1. Site có chặn client tự động không?
 *   2. Nếu có, chặn theo User-Agent hay theo IP?
 *   3. Có giao diện máy đọc nào (robots.txt, RSS, REST) dùng được không?
 *
 * Vì sao câu 2 quan trọng: nếu chặn theo IP thì máy cá nhân của bạn có thể chạy
 * được nhưng GitHub Actions thì KHÔNG — runner dùng IP datacenter. Biết trước
 * điều đó sẽ thay đổi cả thiết kế lịch chạy.
 *
 * Script CỐ Ý gửi rất ít request, có nghỉ giữa các lần, và KHÔNG giả dạng trình
 * duyệt. Mục đích là đo xem site cho phép gì, không phải tìm cách lách.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const base = process.argv[2];
if (!base) {
  console.error('Thiếu URL. VD: node scripts/probe-source.mjs https://www.novelupdates.com');
  process.exit(1);
}

const origin = new URL(base).origin;

/**
 * Hai định danh, KHÔNG cái nào giả dạng trình duyệt:
 *  - bot   : tự khai báo là crawler, có cách liên hệ (cách lịch sự chuẩn mực)
 *  - plain : không đặt UA, để runtime tự điền
 * Nếu cả hai đều bị chặn -> gần như chắc chắn là chặn theo IP hoặc TLS fingerprint.
 */
const IDENTITIES = [
  { name: 'bot  ', headers: { 'user-agent': 'LumiereBot/0.1 (+contact@example.com)' } },
  { name: 'plain', headers: {} },
];

const PATHS = [
  { path: '/robots.txt', why: 'chính sách crawl do site công bố' },
  { path: '/feed/', why: 'RSS chính (WordPress)' },
  { path: '/wp-json/', why: 'REST API (WordPress)' },
  { path: '/', why: 'trang chủ (HTML)' },
];

console.log(`\nThăm dò ${origin}\n${'─'.repeat(64)}`);

const results = [];

for (const identity of IDENTITIES) {
  for (const target of PATHS) {
    const url = `${origin}${target.path}`;
    let status;
    let note = '';

    try {
      const response = await fetch(url, {
        headers: { accept: '*/*', ...identity.headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      });
      status = response.status;
      const server = response.headers.get('server') ?? '';
      const cfRay = response.headers.get('cf-ray');
      if (cfRay !== null) note = `cloudflare${server ? ` (${server})` : ''}`;
      else if (server) note = server;
    } catch (error) {
      status = 'ERR';
      note = error instanceof Error ? error.message.slice(0, 50) : String(error);
    }

    const ok = status === 200;
    results.push({ identity: identity.name.trim(), path: target.path, status, ok });
    console.log(
      `  ${ok ? '✅' : '❌'} [${identity.name}] ${String(status).padEnd(4)} ${target.path.padEnd(14)} ${note}`,
    );

    // Nghỉ giữa các request — đang thăm dò một site có thể đã chặn mình.
    await sleep(2_000);
  }
}

console.log(`${'─'.repeat(64)}`);

const anyOk = results.some((r) => r.ok);
const botOk = results.some((r) => r.ok && r.identity === 'bot');
const plainOk = results.some((r) => r.ok && r.identity === 'plain');

if (!anyOk) {
  console.log(`
KẾT LUẬN: chặn TOÀN BỘ từ máy này.

  Ngay cả robots.txt cũng không đọc được, và UA tự khai báo lẫn UA mặc định đều
  bị chặn như nhau -> nguyên nhân KHÔNG phải User-Agent.

  Nhiều khả năng là IP reputation hoặc TLS fingerprint (Cloudflare bot management
  chặn trước khi request tới được tầng ứng dụng).

  BƯỚC TIẾP THEO: chạy đúng script này từ MỘT MẠNG KHÁC (VD mạng nhà, 4G).
    - Mạng khác chạy được  -> chặn theo IP. GitHub Actions (IP datacenter) nhiều
                              khả năng CŨNG bị chặn -> cần self-hosted runner
                              hoặc đổi nguồn.
    - Mạng nào cũng chặn   -> site chặn mọi client không phải trình duyệt.
`);
} else if (plainOk && !botOk) {
  console.log(`
KẾT LUẬN: bị chặn theo User-Agent — UA tự khai báo là bot thì bị chặn.

  Đây là căng thẳng thật giữa "lịch sự" và "truy cập được". Đổi sang UA giả
  trình duyệt là đi ngược ý site đã thể hiện -> nên hỏi ý chủ dự án trước.
`);
} else {
  console.log(`
KẾT LUẬN: truy cập được. Xem endpoint nào trả 200 ở trên để chọn giao diện.
  Ưu tiên robots.txt -> RSS -> REST -> HTML (theo thứ tự "thân thiện với máy").
`);
}
