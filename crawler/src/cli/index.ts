import { randomUUID } from 'node:crypto';
import { crawlerConfig } from '../config/crawler.config.js';
import { registerSourceAdapters, sourceRegistry } from '../crawlers/index.js';
import {
  canDiscover,
  canLatest,
  canRefresh,
} from '../core/contracts/ISourceAdapter.js';
import { BlockedError, CrawlerError } from '../core/errors/index.js';
import type { CrawlContext, NovelRef } from '../core/types.js';
import type { RunSummary } from '../core/result/index.js';
import { closePool } from '../database/pool.js';
import { extractPathSlug } from '../extractors/url.extractor.js';
import { CrawlerService } from '../services/index.js';
import { logger } from '../utils/logger.js';
import { HELP_TEXT, parseArgs } from './args.js';

/**
 * Entry point cho người dùng.
 *
 * Ở Phase 5 lệnh này mới chỉ CRAWL và IN ra — chưa ghi database. Importer và
 * repositories thuộc Phase 6. Nhờ vậy có thể kiểm chứng tầng lấy dữ liệu bằng
 * mắt trước khi cho nó đụng vào dữ liệu thật.
 */
/** Lỗi do người dùng nhập sai — in gọn, không kèm stack trace. */
class UsageError extends Error {}

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    /*
     * Nhập sai tham số KHÔNG phải lỗi hệ thống. In một dòng kèm gợi ý --help,
     * thay vì đổ stack trace khiến người dùng tưởng crawler bị hỏng.
     */
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  registerSourceAdapters();

  // Kiểm tra nguồn + mode NGAY, trước khi gửi request nào: một job chạy 20 phút
  // rồi mới báo "mode không hỗ trợ" là lãng phí hoàn toàn.
  const adapter = sourceRegistry.getForMode(args.source, args.mode);

  const ctx: CrawlContext = {
    runId: randomUUID(),
    sourceId: args.source,
    mode: args.mode,
    maxItems: args.limit,
    dryRun: args.dryRun,
    startedAt: new Date(),
  };

  const log = logger.child({ runId: ctx.runId, source: ctx.sourceId, mode: ctx.mode });

  /*
   * Không dry-run -> đi qua CrawlerService để THỰC SỰ ghi database:
   * nó mở sync_run, import từng novel trong transaction riêng, ghi sync_events,
   * rồi đóng sổ. Dry-run thì gọi thẳng adapter và chỉ in ra.
   */
  if (!ctx.dryRun) {
    const summary = await new CrawlerService().run(adapter, ctx.mode, {
      maxItems: args.limit,
      dryRun: false,
      force: args.force,
      ...(args.urls.length > 0 || args.ids.length > 0
        ? { targets: buildRefreshTargets(args.urls, args.ids, ctx.sourceId) }
        : {}),
    });

    printRunSummary(summary);
    if (args.json) console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const startedAt = Date.now();
  let payload: unknown;
  let count = 0;

  switch (ctx.mode) {
    case 'latest': {
      if (!canLatest(adapter)) throw new Error(`${adapter.sourceId} không hỗ trợ mode latest`);
      const releases = await adapter.latest(ctx);
      count = releases.length;
      payload = releases;
      break;
    }

    case 'discover': {
      if (!canDiscover(adapter)) throw new Error(`${adapter.sourceId} không hỗ trợ mode discover`);
      const refs = await adapter.discover(ctx);
      count = refs.length;
      payload = refs;
      break;
    }

    case 'refresh': {
      if (!canRefresh(adapter)) throw new Error(`${adapter.sourceId} không hỗ trợ mode refresh`);

      const targets = buildRefreshTargets(args.urls, args.ids, ctx.sourceId);
      if (targets.length === 0) {
        /*
         * Chưa có RunPlanner (Phase 9) để chọn novel cũ nhất từ
         * novel_sources.last_crawled_at, nên hiện phải chỉ định URL bằng tay.
         */
        log.error('Mode refresh hiện cần ít nhất một --url (RunPlanner thuộc Phase 9).');
        process.exitCode = 1;
        return;
      }

      const novels = await adapter.refresh(ctx, targets);
      count = novels.length;
      payload = novels;
      break;
    }
  }

  const durationMs = Date.now() - startedAt;

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printSummary(ctx.mode, payload, count);
  }

  log.info({ count, durationMs, dryRun: ctx.dryRun }, 'hoàn tất');
}

/**
 * Dựng danh sách mục tiêu cho mode `refresh`.
 *
 * `--id` là cách ĐÁNG TIN CẬY hơn, vì cách suy ra external_id từ URL khác nhau
 * theo từng nguồn:
 *   NovelUpdates : /series/<slug>/        -> external_id = slug
 *   ScribbleHub  : /series/<id>/<slug>/   -> external_id = id
 * CLI không nên chứa luật riêng của từng nguồn. `--url` vẫn giữ cho tiện, nhưng
 * chỉ dùng được với nguồn có external_id nằm ở đoạn cuối đường dẫn.
 */
function buildRefreshTargets(
  urls: readonly string[],
  ids: readonly string[],
  sourceId: string,
): NovelRef[] {
  const targets: NovelRef[] = [];

  for (const externalId of ids) {
    // Adapter tự dựng URL thật từ external_id — nó mới biết cấu trúc của nguồn.
    targets.push({ sourceId, externalId, sourceUrl: '' });
  }

  for (const url of urls) {
    const externalId = extractPathSlug(url, '/series/');
    if (externalId === null) {
      logger.warn({ url }, 'bỏ qua: không tách được external_id từ URL — thử dùng --id');
      continue;
    }
    targets.push({ sourceId, externalId, sourceUrl: url });
  }

  return targets;
}

/**
 * Bảng tóm tắt ngắn — dễ soi bằng mắt hơn JSON khi có hàng chục dòng.
 *
 * Đọc theo shape ĐÃ CHUẨN HOÁ (NormalizedNovel / NormalizedLatestRelease),
 * giống nhau ở mọi nguồn — đó là điểm lợi của việc adapter trả dữ liệu canonical
 * thay vì raw riêng từng site.
 */
function printSummary(mode: string, payload: unknown, count: number): void {
  console.log(`\n${mode}: ${count} item\n`);
  if (!Array.isArray(payload)) return;

  for (const item of payload.slice(0, 15)) {
    const record = item as Record<string, unknown>;

    switch (mode) {
      case 'latest': {
        const chapter = record['chapter'] as Record<string, unknown> | null;
        const group = record['translationGroupName'];
        console.log(
          `  ${truncate(text(record['novelTitle']), 44).padEnd(46)}` +
            `│ ${text(chapter?.['displayTitle'], '(không rõ chương)')}` +
            (group === null || group === undefined ? '' : `  [${String(group)}]`),
        );
        break;
      }

      case 'discover':
        console.log(`  ${text(record['externalId'])}  ${text(record['sourceUrl'], '')}`);
        break;

      case 'refresh': {
        const chapter = record['latestChapter'] as Record<string, unknown> | null;
        const publishedAt = chapter?.['publishedAt'];
        const genres = record['genres'];
        console.log(
          `  ${text(record['title'])}\n` +
            `    status : ${text(record['status'])}\n` +
            `    rating : ${text(record['rating'])} (${text(record['ratingsCount'])} phiếu)\n` +
            `    chương : ${text(record['totalChapters'])} — mới nhất: ` +
            `${text(chapter?.['displayTitle'], '(không có)')}` +
            `${publishedAt instanceof Date ? ` @ ${publishedAt.toISOString().slice(0, 10)}` : ''}\n` +
            `    genres : ${Array.isArray(genres) ? genres.slice(0, 5).join(', ') : ''}`,
        );
        break;
      }

      default:
        console.log(`  ${JSON.stringify(item)}`);
    }
  }

  if (payload.length > 15) console.log(`  … và ${payload.length - 15} item nữa`);
  console.log('');
}

/**
 * Tóm tắt một lần chạy CÓ GHI database.
 *
 * `unchanged` được tách riêng khỏi `updated` là có chủ đích: ở mode refresh thì
 * phần lớn novel sẽ là `unchanged` nhờ so content_hash, và nhìn thấy con số đó
 * là cách nhanh nhất để biết update detection đang hoạt động.
 */
function printRunSummary(summary: RunSummary): void {
  const t = summary.totals;
  console.log(`\n${summary.sourceId} / ${summary.mode}  —  ${summary.durationMs}ms\n`);
  console.log(`  đã xem     : ${t.seen}`);
  console.log(`  tạo mới    : ${t.created}`);
  console.log(`  cập nhật   : ${t.updated}`);
  console.log(`  không đổi  : ${t.unchanged}   ← content_hash trùng, bỏ qua ghi`);
  console.log(`  bỏ qua     : ${t.skipped}`);
  console.log(`  thất bại   : ${t.failed}`);
  console.log(`  chương mới : ${t.chaptersAdded}`);
  console.log(`  nội dung   : ${t.contentsWritten} ghi / ${t.contentsFetched} tải về`);

  /*
   * Cảnh báo TƯỜNG MINH khi tải được text mà không ghi được dòng nào.
   *
   * Đây chính là triệu chứng đã âm thầm tồn tại qua nhiều lần chạy: bảng
   * `chapters` đầy lên, `chapter_contents` vẫn rỗng, mà bản tóm tắt không hề
   * nhắc tới. Im lặng ở đây đọc y hệt như thành công.
   *
   * So `fetched` với `written` chứ không chỉ nhìn `written === 0`: novel đã đủ
   * nội dung thì không tải gì cả, và đó là kết quả ĐÚNG, không phải sự cố.
   */
  if (t.contentsFetched > 0 && t.contentsWritten === 0) {
    console.log(
      `\n  ⚠️  Đã tải ${t.contentsFetched} chương text nhưng KHÔNG ghi được dòng nào` +
        ` vào chapter_contents.\n      Đường ghi đang hỏng — chạy lại với LOG_LEVEL=debug.`,
    );
  }

  if (summary.mode === 'refresh' && crawlerConfig.contentChaptersPerNovel === 0) {
    console.log(`\n  ⚠️  CRAWL_CONTENT_CHAPTERS_PER_NOVEL = 0 — nội dung chương đang TẮT.`);
  }

  if (summary.truncated) {
    console.log(`\n  ⚠️  Chạm trần --limit — dữ liệu bị cắt bớt, chưa xử lý hết.`);
  }

  for (const failure of summary.failures.slice(0, 5)) {
    console.log(`\n  ✖ ${failure.externalId}: ${failure.error?.message ?? failure.reason ?? ''}`);
  }
  console.log('');
}

/** Hiển thị giá trị có thể vắng mặt mà không in ra chuỗi 'undefined'. */
function text(value: unknown, fallback = '—'): string {
  return value === null || value === undefined ? fallback : String(value);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/*
 * Đóng pool ở MỌI nhánh thoát.
 *
 * `pg.Pool` giữ socket mở nên event loop không bao giờ rỗng — thiếu bước này
 * thì tiến trình treo sau khi in xong kết quả, và trên GitHub Actions job sẽ
 * chạy tới hết 6 giờ timeout.
 */
main()
  .then(() => closePool())
  .catch(async (error: unknown) => {
    await closePool().catch(() => undefined);

    /*
     * BỊ CHẶN -> THOÁT VỚI MÃ 0.
     *
     * Nguồn trả 403 không phải lỗi của mình, và cũng không phải thứ thử lại được
     * — thử lại chỉ tăng nguy cơ bị cấm IP vĩnh viễn. Trả mã 0 để GitHub Actions
     * KHÔNG đánh dấu workflow là hỏng và KHÔNG kích hoạt retry: đây là kết quả
     * hợp lệ ("nguồn hiện không cho truy cập"), không phải sự cố hạ tầng.
     *
     * Thông báo vẫn được ghi ở mức warn để người vận hành thấy trong log.
     */
    if (error instanceof BlockedError) {
      logger.warn(
        { context: error.context },
        'nguồn từ chối truy cập (403/429) — kết thúc bình thường, KHÔNG retry',
      );
      process.exit(0);
    }

    if (error instanceof UsageError) {
      console.error(`\n${error.message}\n\nChạy --help để xem hướng dẫn.\n`);
    } else if (error instanceof CrawlerError) {
      // Lỗi có chủ đích: in message + ngữ cảnh, không cần stack trace.
      logger.error({ context: error.context, fatal: error.isFatal }, error.message);
    } else {
      logger.error(
        { err: error instanceof Error ? error.stack : String(error) },
        'lỗi ngoài dự kiến',
      );
    }

    process.exit(1);
  });
