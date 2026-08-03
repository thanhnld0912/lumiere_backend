import { getSourceConfig } from '../../config/sources/index.js';
import type { ISourceAdapter } from '../contracts/ISourceAdapter.js';
import { ConfigError, SourceNotFoundError, UnsupportedModeError } from '../errors/index.js';
import type { CrawlMode, SourceId } from '../types.js';

/**
 * Sổ đăng ký các Source Adapter.
 *
 * Đây là ranh giới giữa Core và Adapter. Core chỉ biết interface
 * `ISourceAdapter`; registry là chỗ DUY NHẤT biết những implementation cụ thể
 * nào đang tồn tại. Nhờ vậy thêm nguồn mới không phải sửa bất kỳ tầng nào khác.
 *
 * Instance rỗng khi khởi tạo — adapter tự đăng ký ở `crawlers/index.ts` (Phase 3).
 * Cách này tránh phụ thuộc vòng: registry không import adapter, adapter import
 * registry.
 */
export class SourceRegistry {
  private readonly adapters = new Map<SourceId, ISourceAdapter>();

  register(adapter: ISourceAdapter): this {
    if (this.adapters.has(adapter.sourceId)) {
      throw new ConfigError(`Source adapter '${adapter.sourceId}' đã được đăng ký`, {
        sourceId: adapter.sourceId,
      });
    }

    // Adapter phải có config tương ứng — bắt lỗi lúc khởi động thay vì lúc chạy.
    if (!getSourceConfig(adapter.sourceId)) {
      throw new ConfigError(
        `Adapter '${adapter.sourceId}' không có config tương ứng. ` +
          `Thêm nó vào config/sources/index.ts.`,
        { sourceId: adapter.sourceId },
      );
    }

    this.adapters.set(adapter.sourceId, adapter);
    return this;
  }

  has(sourceId: SourceId): boolean {
    return this.adapters.has(sourceId);
  }

  list(): readonly SourceId[] {
    return [...this.adapters.keys()];
  }

  listAdapters(): readonly ISourceAdapter[] {
    return [...this.adapters.values()];
  }

  /** Lấy adapter, ném lỗi có thông tin hữu ích nếu không có. */
  get(sourceId: SourceId): ISourceAdapter {
    const adapter = this.adapters.get(sourceId);
    if (!adapter) {
      throw new SourceNotFoundError(sourceId, this.list());
    }
    return adapter;
  }

  /**
   * Lấy adapter và kiểm tra luôn nó chạy được mode yêu cầu.
   *
   * Kiểm tra ở đây thay vì để adapter tự ném lỗi giữa chừng: một job chạy 20
   * phút rồi mới báo "mode không hỗ trợ" là lãng phí hoàn toàn.
   */
  getForMode(sourceId: SourceId, mode: CrawlMode): ISourceAdapter {
    const adapter = this.get(sourceId);

    if (!adapter.supports(mode)) {
      const supported = adapter.config.modes;
      throw new UnsupportedModeError(sourceId, mode, supported);
    }

    return adapter;
  }
}

/** Registry dùng chung toàn tiến trình. */
export const sourceRegistry = new SourceRegistry();
