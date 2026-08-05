import { crawlerConfig, DEFAULT_HTTP, DEFAULT_POLITENESS } from '../crawler.config.js';
import type { SourceConfig } from './types.js';

/**
 * ScribbleHub — nguồn dùng REST API CHÍNH THỨC, không scrape HTML.
 *
 * Đo được 2026-08-03 (`npm run probe -- https://www.scribblehub.com`):
 *   /robots.txt   200   (chỉ chặn /wp-admin/)
 *   /wp-json/     200   130 route, không cần token cho endpoint đọc
 *   /feed/        200
 *   /             403   ← HTML BỊ CHẶN
 *
 * Tổ hợp đó là site nói rất rõ: dùng API, đừng scrape HTML. Adapter tôn trọng
 * điều đó — nó KHÔNG bao giờ gọi tới trang HTML nào.
 */
export interface ScribbleHubConfig extends SourceConfig {
  readonly apiBase: string;
  readonly paths: {
    /** Chương mới phát hành — nguồn cho mode `latest`. Trả cả story lẫn chapter. */
    readonly updates: string;
    /** Danh sách truyện — nguồn cho mode `discover`. */
    readonly stories: string;
    /** Chi tiết một truyện — nguồn cho mode `refresh`. `{id}` được thay thế. */
    readonly storyDetail: string;
    readonly storyChapters: string;
    /**
     * Nội dung MỘT chương. Endpoint danh sách trả `content: ""` cho mọi chương —
     * chỉ endpoint này mới có text.
     */
    readonly chapterDetail: string;
  };

  /**
   * Trần số chương tải nội dung cho MỖI novel, trong MỘT lần chạy.
   *
   * Mỗi chương là một request. Novel 991 chương ở tốc độ lịch sự 30 req/phút mất
   * 33 phút cho riêng nó — sẽ làm job vượt giới hạn 6 giờ của GitHub Actions.
   *
   * Đặt trần thì chương đầu có nội dung ngay, phần còn lại các lượt refresh sau
   * lấy tiếp. Đặt 0 để tắt hẳn việc tải nội dung.
   */
  readonly contentChaptersPerNovel: number;
  /** Số item mỗi trang. API mặc định 25; giữ nguyên để không tạo tải bất thường. */
  readonly perPage: number;
}

export const scribbleHubConfig: ScribbleHubConfig = {
  id: 'scribblehub',
  name: 'ScribbleHub',
  baseUrl: 'https://www.scribblehub.com',
  enabled: true,

  modes: ['discover', 'refresh', 'latest'],

  politeness: {
    ...DEFAULT_POLITENESS,
    /*
     * API chịu tải tốt hơn HTML, nhưng vẫn giữ chậm.
     *
     * Mode `latest` chỉ cần MỘT request cho 25 novel, và `refresh` chạy hàng
     * tháng — không có lý do gì phải đi nhanh. Chậm và ổn định thì không bao giờ
     * phải xử lý sự cố bị chặn.
     */
    maxRequestsPerMinute: Math.min(DEFAULT_POLITENESS.maxRequestsPerMinute, 30),
    maxConcurrency: 1, // BaseApiCrawler gọi tuần tự để giữ khoảng cách đều
    minDelayMs: 1_200,
    respectRobotsTxt: true,
  },

  http: {
    ...DEFAULT_HTTP,
    maxRequestRetries: 3,
    requestTimeoutSecs: 25,
    // API thuần JSON — không có JavaScript nào để chạy.
    requiresJavaScript: false,
  },

  /*
   * Ngưỡng chặt hơn nguồn HTML.
   *
   * API có hợp đồng ổn định: nếu field bắt đầu thiếu thì đó là thay đổi phá vỡ
   * tương thích, không phải chuyện vặt như đổi selector. Phát hiện sớm và dừng.
   */
  schemaDriftThreshold: 0.1,
  schemaDriftMinSamples: crawlerConfig.schemaDriftMinSamples,

  apiBase: 'https://www.scribblehub.com/wp-json/fictionapp/v1',
  paths: {
    updates: '/updates',
    stories: '/stories',
    storyDetail: '/stories/{id}',
    storyChapters: '/stories/{id}/chapters',
    chapterDetail: '/chapters/{id}',
  },
  perPage: 25,
  contentChaptersPerNovel: crawlerConfig.contentChaptersPerNovel,
};
