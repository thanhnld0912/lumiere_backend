import { crawlerConfig, DEFAULT_HTTP, DEFAULT_POLITENESS } from '../crawler.config.js';
import type { SourceConfig } from './types.js';

/**
 * Cấu hình riêng của NovelUpdates.
 *
 * Đây là nguồn ĐẦU TIÊN, không phải nguồn duy nhất. Không có gì ở tầng core
 * import file này — nó chỉ được nhắc tới trong registry.
 */

/** Đường dẫn riêng của NU. Mở rộng SourceConfig vì mỗi site có cấu trúc URL khác. */
export interface NovelUpdatesConfig extends SourceConfig {
  readonly paths: {
    /** Danh mục có phân trang — nguồn cho mode `discover`. */
    readonly browse: string;
    /** Feed chương mới — nguồn cho mode `latest`, trang rẻ nhất và quan trọng nhất. */
    readonly latestReleases: string;
    /** Tiền tố trang chi tiết; externalId nối vào sau. */
    readonly seriesPrefix: string;
  };
  /**
   * D3 (đã chốt lại) — KHÔNG lọc theo ngôn ngữ.
   *
   * Trường "Language" của NovelUpdates là **ngôn ngữ GỐC** của tác phẩm
   * (Chinese / Korean / Japanese), không phải ngôn ngữ bản dịch — cả hai fixture
   * đều ghi 'Chinese'. Mà gần như mọi series NU index đều đã có bản dịch tiếng
   * Anh, vì đó chính là mục đích của site.
   *
   * Nên `novels.language` lưu đúng giá trị nguồn cho, và không có bộ lọc nào.
   */
  readonly filterByLanguage: null;
}

export const novelUpdatesConfig: NovelUpdatesConfig = {
  id: 'novelupdates',
  name: 'NovelUpdates',
  baseUrl: 'https://www.novelupdates.com',
  enabled: true,

  modes: ['discover', 'refresh', 'latest'],

  politeness: {
    ...DEFAULT_POLITENESS,
    /*
     * Cố tình chậm hơn mặc định.
     *
     * NovelUpdates có bảo vệ chống bot và crawl mạnh tay là bị chặn. Ta không
     * vội: `refresh` chạy hàng tháng, còn `latest` chỉ đọc vài trang. Không có
     * lý do gì để đi nhanh, mà rủi ro bị chặn thì không thể tự khắc phục.
     */
    maxRequestsPerMinute: Math.min(DEFAULT_POLITENESS.maxRequestsPerMinute, 20),
    maxConcurrency: Math.min(DEFAULT_POLITENESS.maxConcurrency, 2),
    minDelayMs: 1_500,
    respectRobotsTxt: true,
  },

  http: {
    ...DEFAULT_HTTP,
    /*
     * NovelUpdates render phía server -> CheerioCrawler là đủ.
     * Giữ false trừ khi có bằng chứng ngược lại: bật Playwright sẽ kéo Chromium
     * về (~300MB) và làm chậm CI đi hàng phút.
     */
    requiresJavaScript: false,
  },

  schemaDriftThreshold: crawlerConfig.schemaDriftThreshold,
  schemaDriftMinSamples: crawlerConfig.schemaDriftMinSamples,

  paths: {
    browse: '/series-ranking/',
    latestReleases: '/',
    seriesPrefix: '/series/',
  },

  filterByLanguage: null,
};
