/**
 * Cây lỗi của crawler.
 *
 * Phân biệt hai loại vì chúng được xử lý khác nhau:
 *  - `isFatal = true`  : dừng cả lần chạy (sai config, mất DB)
 *  - `isFatal = false` : ghi lại, bỏ qua item đó, chạy tiếp (parse hỏng 1 trang)
 *
 * Một trang HTML đổi layout không được phép giết cả job đang xử lý 5.000 novel.
 */

export abstract class CrawlerError extends Error {
  abstract readonly isFatal: boolean;

  constructor(
    message: string,
    readonly context: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = new.target.name;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Cấu hình sai — luôn fatal, phát hiện càng sớm càng tốt. */
export class ConfigError extends CrawlerError {
  readonly isFatal = true;
}

/**
 * HTML không khớp selector mong đợi.
 *
 * KHÔNG fatal: bỏ qua item này. Nhưng nếu tỉ lệ ParseError vượt ngưỡng thì
 * SchemaDriftError sẽ được ném ra — dấu hiệu site đã đổi layout.
 */
export class ParseError extends CrawlerError {
  readonly isFatal = false;

  constructor(
    message: string,
    readonly url: string,
    readonly field?: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, { ...context, url, field });
  }
}

/**
 * Quá nhiều item parse hỏng — gần như chắc chắn site đã đổi HTML.
 *
 * FATAL, và đây là chủ đích: thà dừng lại và báo động còn hơn âm thầm ghi đè dữ
 * liệu tốt bằng vài nghìn bản ghi rỗng.
 */
export class SchemaDriftError extends CrawlerError {
  readonly isFatal = true;

  constructor(
    readonly sourceId: string,
    readonly failureRate: number,
    readonly threshold: number,
    context: Record<string, unknown> = {},
  ) {
    super(
      `[${sourceId}] tỉ lệ parse hỏng ${(failureRate * 100).toFixed(1)}% vượt ngưỡng ` +
        `${(threshold * 100).toFixed(1)}% — nhiều khả năng site đã đổi HTML. ` +
        `Dừng lại để không ghi đè dữ liệu tốt bằng dữ liệu rỗng.`,
      { ...context, sourceId, failureRate, threshold },
    );
  }
}

/**
 * Nguồn từ chối phục vụ (403 / 429 / bot protection).
 *
 * FATAL, và dừng NGAY. Đây là quyết định có chủ đích: site đã nói "không" thì
 * thử lại chỉ làm tình hình xấu hơn, và với IP dùng chung của GitHub Actions
 * runner thì bị chặn vĩnh viễn là hỏng không gỡ được.
 */
export class BlockedError extends CrawlerError {
  readonly isFatal = true;

  constructor(sourceId: string, context: Record<string, unknown> = {}) {
    super(
      `[${sourceId}] nguồn trả về 403/429 — request bị chặn.\n` +
        `  Nguyên nhân thường gặp: bot protection (Cloudflare) chặn HTTP client thuần.\n` +
        `  ĐÃ DỪNG thay vì thử lại: retry khi đã bị chặn chỉ làm tăng nguy cơ bị cấm IP.`,
      { ...context, sourceId },
    );
  }
}

/** Chuẩn hoá thất bại (VD status không map được, rating không parse ra số). */
export class NormalizationError extends CrawlerError {
  readonly isFatal = false;
}

/** Ghi database thất bại cho MỘT item. Không fatal — item khác vẫn chạy tiếp. */
export class ImportError extends CrawlerError {
  readonly isFatal = false;
}

/** Không tìm thấy adapter cho sourceId. */
export class SourceNotFoundError extends CrawlerError {
  readonly isFatal = true;

  constructor(sourceId: string, available: readonly string[]) {
    super(
      `Không có source adapter nào cho '${sourceId}'. Hiện có: ${available.join(', ') || '(chưa có)'}`,
      { sourceId, available },
    );
  }
}

/** Adapter không hỗ trợ mode được yêu cầu. */
export class UnsupportedModeError extends CrawlerError {
  readonly isFatal = true;

  constructor(sourceId: string, mode: string, supported: readonly string[]) {
    super(`Source '${sourceId}' không hỗ trợ mode '${mode}'. Hỗ trợ: ${supported.join(', ')}`, {
      sourceId,
      mode,
      supported,
    });
  }
}
