import { randomUUID } from 'node:crypto';
import { registerSourceAdapters, sourceRegistry } from '../crawlers/index.js';
import {
  canDiscover,
  canLatest,
  canRefresh,
} from '../core/contracts/ISourceAdapter.js';
import { CrawlerError } from '../core/errors/index.js';
import type { CrawlContext, NovelRef } from '../core/types.js';
import { extractPathSlug } from '../extractors/url.extractor.js';
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

  if (!ctx.dryRun) {
    log.warn(
      'Phase 5 chưa có tầng ghi database — lần chạy này chỉ crawl và in kết quả. ' +
        'Dùng --dry-run để bỏ cảnh báo này.',
    );
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

      const targets = buildRefreshTargets(args.urls, ctx.sourceId);
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

/** Đổi URL người dùng nhập thành NovelRef, tách external_id từ đường dẫn. */
function buildRefreshTargets(urls: readonly string[], sourceId: string): NovelRef[] {
  const targets: NovelRef[] = [];

  for (const url of urls) {
    const externalId = extractPathSlug(url, '/series/');
    if (externalId === null) {
      logger.warn({ url }, 'bỏ qua: không tách được external_id (URL series không hợp lệ?)');
      continue;
    }
    targets.push({ sourceId, externalId, sourceUrl: url });
  }

  return targets;
}

/** Bảng tóm tắt ngắn — dễ soi bằng mắt hơn JSON khi có hàng chục dòng. */
function printSummary(mode: string, payload: unknown, count: number): void {
  console.log(`\n${mode}: ${count} item\n`);
  if (!Array.isArray(payload)) return;

  for (const item of payload.slice(0, 15)) {
    const record = item as Record<string, unknown>;
    switch (mode) {
      case 'latest':
        console.log(
          `  ${String(record['chapterLabel']).padEnd(12)} ${String(record['novelTitle'])}` +
            `  [${String(record['translationGroup'])}]`,
        );
        break;
      case 'discover':
        console.log(`  ${String(record['externalId'])}`);
        break;
      case 'refresh':
        console.log(
          `  ${String(record['title'])}\n` +
            `    status : ${String(record['status'])}\n` +
            `    rating : ${String(record['rating'])}\n` +
            `    latest : ${String(record['latestChapterLabel'])} (${String(record['latestChapterDate'])})\n` +
            `    genres : ${(record['genres'] as string[] | undefined)?.slice(0, 5).join(', ') ?? ''}`,
        );
        break;
      default:
        console.log(`  ${JSON.stringify(item)}`);
    }
  }

  if (payload.length > 15) console.log(`  … và ${payload.length - 15} item nữa`);
  console.log('');
}

main().catch((error: unknown) => {
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
