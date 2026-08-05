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
  /**
   * Định danh bên nguồn, dùng thay `--url`.
   *
   * Cần thiết vì cách suy ra external_id từ URL KHÁC NHAU theo từng nguồn:
   *   NovelUpdates : /series/<slug>/          -> external_id = slug
   *   ScribbleHub  : /series/<id>/<slug>/     -> external_id = id
   * CLI không nên chứa luật riêng của từng nguồn, nên cho phép chỉ định thẳng.
   */
  readonly ids: readonly string[];
  /** Ghi lại bất kể content_hash — dùng sau khi sửa bug ở đường ghi. */
  readonly force: boolean;
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
  --id <externalId>   định danh bên nguồn (lặp lại được). VD ScribbleHub: 2441502
  --dry-run           crawl và normalize bình thường nhưng KHÔNG ghi database
  --force             ghi lại bất kể content_hash (dùng sau khi sửa bug ghi)
  --json              in kết quả dạng JSON thay vì bảng tóm tắt
  --help              hiện trợ giúp

Ví dụ
  npm run crawl -- --source novelupdates --mode latest --limit 5 --dry-run
  npm run crawl -- --source scribblehub --mode refresh --dry-run --id 2441502
  npm run crawl -- --source novelupdates --mode refresh --dry-run \\
    --url https://www.novelupdates.com/series/humanitys-great-sage/
`.trim();

export function parseArgs(argv: readonly string[]): CliArgs {
  // Không truyền --source thì dùng nguồn mặc định từ env (CRAWL_DEFAULT_SOURCE).
  let source = crawlerConfig.defaultSource;
  let mode = '';
  let limit = crawlerConfig.maxItemsPerRun;
  // Mặc định lấy từ env, cờ --dry-run chỉ có thể BẬT thêm, không tắt được.
  let dryRun = crawlerConfig.dryRun;
  let help = false;
  let json = false;
  let force = false;
  const urls: string[] = [];
  const ids: string[] = [];

  /*
   * Chuẩn hoá `--key=value` thành `--key value` trước khi phân tích.
   *
   * Hai dạng đều thông dụng và người dùng không nên phải nhớ mình đang dùng dạng
   * nào. Chỉ tách ở dấu `=` ĐẦU TIÊN — URL có chứa `=` trong query string.
   */
  const tokens: string[] = [];
  for (const raw of argv) {
    if (raw.startsWith('--') && raw.includes('=')) {
      const splitAt = raw.indexOf('=');
      tokens.push(raw.slice(0, splitAt), raw.slice(splitAt + 1));
    } else {
      tokens.push(raw);
    }
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const arg = tokens[i];

    switch (arg) {
      case '--source':
        source = tokens[++i] ?? '';
        break;
      case '--mode':
        mode = tokens[++i] ?? '';
        break;
      case '--limit': {
        const value = Number.parseInt(tokens[++i] ?? '', 10);
        if (!Number.isInteger(value) || value < 1) {
          throw new Error(`--limit phải là số nguyên dương, nhận được: ${tokens[i] ?? ""}`);
        }
        limit = value;
        break;
      }
      case '--url': {
        const value = tokens[++i];
        if (value === undefined) throw new Error('--url thiếu giá trị');
        urls.push(value);
        break;
      }
      case '--id': {
        const value = tokens[++i];
        if (value === undefined) throw new Error('--id thiếu giá trị');
        ids.push(value);
        break;
      }
      case '--force':
        force = true;
        break;
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
    return { source, mode: 'latest', limit, dryRun, urls, ids, force, help: true, json };
  }

  if (source === '') throw new Error('Thiếu --source. Chạy --help để xem hướng dẫn.');
  if (!isCrawlMode(mode)) {
    throw new Error(`--mode không hợp lệ: '${mode}'. Nhận: discover | refresh | latest`);
  }
  if ((urls.length > 0 || ids.length > 0) && mode !== 'refresh') {
    throw new Error('--url và --id chỉ dùng được với --mode refresh');
  }

  return { source, mode, limit, dryRun, urls, ids, force, help: false, json };
}
