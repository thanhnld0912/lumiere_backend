import { crawlerConfig } from '../config/crawler.config.js';
import { isCrawlMode, type CrawlMode, type SourceId } from '../core/types.js';

/**
 * Phân tích tham số dòng lệnh — không dùng thư viện ngoài.
 *
 * Nhu cầu ở đây rất hẹp (vài cờ đơn giản), nên thêm `commander` chỉ tổ tăng
 * kích thước cài đặt trên CI mà không đổi lại được gì.
 */
export interface CliArgs {
  readonly source: SourceId;
  readonly mode: CrawlMode;
  readonly limit: number;
  readonly dryRun: boolean;
  /** Với mode `refresh`: chỉ crawl đúng các URL này thay vì hỏi RunPlanner. */
  readonly urls: readonly string[];
  readonly help: boolean;
  readonly json: boolean;
}

export const HELP_TEXT = `
Lumiere crawler

  npm run crawl -- --source <id> --mode <mode> [tuỳ chọn]

Bắt buộc
  --source <id>       id nguồn, VD novelupdates
  --mode <mode>       discover | refresh | latest

Tuỳ chọn
  --limit <n>         trần số item cho lần chạy này (mặc định ${crawlerConfig.maxItemsPerRun})
  --url <url>         chỉ crawl URL này (lặp lại được). Chỉ dùng với mode refresh
  --dry-run           crawl và normalize bình thường nhưng KHÔNG ghi database
  --json              in kết quả dạng JSON thay vì bảng tóm tắt
  --help              hiện trợ giúp

Ví dụ
  npm run crawl -- --source novelupdates --mode latest --limit 5 --dry-run
  npm run crawl -- --source novelupdates --mode refresh --dry-run \\
    --url https://www.novelupdates.com/series/humanitys-great-sage/
`.trim();

export function parseArgs(argv: readonly string[]): CliArgs {
  let source = '';
  let mode = '';
  let limit = crawlerConfig.maxItemsPerRun;
  // Mặc định lấy từ env, cờ --dry-run chỉ có thể BẬT thêm, không tắt được.
  let dryRun = crawlerConfig.dryRun;
  let help = false;
  let json = false;
  const urls: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case '--source':
        source = argv[++i] ?? '';
        break;
      case '--mode':
        mode = argv[++i] ?? '';
        break;
      case '--limit': {
        const value = Number.parseInt(argv[++i] ?? '', 10);
        if (!Number.isInteger(value) || value < 1) {
          throw new Error(`--limit phải là số nguyên dương, nhận được: ${argv[i] ?? ''}`);
        }
        limit = value;
        break;
      }
      case '--url': {
        const value = argv[++i];
        if (value === undefined) throw new Error('--url thiếu giá trị');
        urls.push(value);
        break;
      }
      case '--dry-run':
        dryRun = true;
        break;
      case '--json':
        json = true;
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        if (arg !== undefined && arg.startsWith('--')) {
          throw new Error(`Tham số không nhận diện được: ${arg}`);
        }
    }
  }

  if (help) {
    return { source, mode: 'latest', limit, dryRun, urls, help: true, json };
  }

  if (source === '') throw new Error('Thiếu --source. Chạy --help để xem hướng dẫn.');
  if (!isCrawlMode(mode)) {
    throw new Error(`--mode không hợp lệ: '${mode}'. Nhận: discover | refresh | latest`);
  }
  if (urls.length > 0 && mode !== 'refresh') {
    throw new Error('--url chỉ dùng được với --mode refresh');
  }

  return { source, mode, limit, dryRun, urls, help: false, json };
}
