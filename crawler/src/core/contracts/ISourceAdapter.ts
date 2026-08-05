import type { SourceConfig } from '../../config/sources/types.js';
import type { NormalizedLatestRelease, NormalizedNovel } from '../../dto/index.js';
import type { CrawlContext, CrawlMode, NovelRef, SourceId } from '../types.js';

/**
 * ⭐ HỢP ĐỒNG TRUNG TÂM — mọi nguồn đều implement interface này.
 *
 *      ISourceAdapter
 *            ├── NovelUpdatesAdapter   (nguồn đầu tiên)
 *            ├── RoyalRoadAdapter      (sau này)
 *            ├── ScribbleHubAdapter
 *            └── …
 *
 * Thêm nguồn mới = tạo một class implement interface này + đăng ký vào
 * SourceRegistry. **Không sửa file nào đang có.** Đó là bài kiểm tra thật sự cho
 * tính mở rộng — nếu phải sửa core khi thêm nguồn thứ hai thì thiết kế đã sai.
 *
 * Ba phương thức crawl là OPTIONAL, và `supports()` khai báo mình làm được gì.
 * Lý do: không phải nguồn nào cũng có feed "latest releases", và không phải
 * nguồn nào cũng cho duyệt danh mục. Ép mọi adapter implement cả ba sẽ đẻ ra
 * một đống method ném `NotImplemented` — vi phạm Interface Segregation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * VÌ SAO ADAPTER TRẢ DỮ LIỆU ĐÃ CHUẨN HOÁ, KHÔNG PHẢI DỮ LIỆU THÔ
 *
 * Ban đầu hợp đồng này trả `RawNovel` — một DTO mà MỌI field đều là string, vì
 * đó là thứ HTML cho ta. Thêm nguồn thứ hai (ScribbleHub) làm lộ ra khiếm khuyết:
 * nguồn đó là REST API và đã trả về `ratingAverage: 4.3`, `readCount: 43443`,
 * `publishedAt: '2026-08-04T11:32:17+00:00'` — dữ liệu CÓ KIỂU sẵn. Ép chúng
 * thành string để normalizer parse ngược lại vừa thừa vừa mất mát.
 *
 * Nên ranh giới được đặt lại: adapter chịu trách nhiệm biến byte thành dữ liệu
 * canonical, còn CÁCH làm là chuyện riêng của nó —
 *   nguồn HTML : fetch -> parse (Cheerio) -> normalize
 *   nguồn API  : fetch -> normalize        (không cần parse)
 *
 * Tách parser/normalizer vẫn còn nguyên, nhưng ở BÊN TRONG `crawlers/<nguồn>/`,
 * nơi nó thuộc về. Mọi tầng phía trên chỉ thấy `NormalizedNovel`.
 * ─────────────────────────────────────────────────────────────────────────
 */
export interface ISourceAdapter {
  readonly sourceId: SourceId;
  readonly config: SourceConfig;

  /** Adapter này chạy được mode đó không? Registry kiểm tra trước khi gọi. */
  supports(mode: CrawlMode): boolean;

  /**
   * Mode `discover` — duyệt danh mục tìm novel MỚI.
   *
   * Chỉ trả CON TRỎ (NovelRef), không trả metadata đầy đủ: trang danh mục
   * thường chỉ có tiêu đề + ảnh bìa, và ta chưa cần biết hơn thế ở bước này.
   * Việc lấy chi tiết là của `refresh`.
   */
  discover?(ctx: CrawlContext): Promise<readonly NovelRef[]>;

  /**
   * Mode `refresh` — crawl metadata đầy đủ cho các novel đã biết.
   *
   * Nhận đầu vào là danh sách cụ thể (do RunPlanner chọn theo
   * `novel_sources.last_crawled_at` cũ nhất) chứ không tự quyết định crawl gì —
   * chính sách chọn việc thuộc về scheduler, không thuộc về adapter.
   */
  refresh?(
    ctx: CrawlContext,
    targets: readonly NovelRef[],
  ): Promise<readonly NormalizedNovel[]>;

  /**
   * Mode `latest` — đọc feed chương mới phát hành.
   *
   * Chế độ rẻ nhất và chạy thường xuyên nhất: một trang cho biết hàng trăm novel
   * vừa có chương mới.
   */
  latest?(ctx: CrawlContext): Promise<readonly NormalizedLatestRelease[]>;
}

/* ── Type guard: thu hẹp kiểu để gọi được method optional một cách an toàn ── */

export type DiscoverCapable = ISourceAdapter &
  Required<Pick<ISourceAdapter, 'discover'>>;
export type RefreshCapable = ISourceAdapter & Required<Pick<ISourceAdapter, 'refresh'>>;
export type LatestCapable = ISourceAdapter & Required<Pick<ISourceAdapter, 'latest'>>;

export function canDiscover(adapter: ISourceAdapter): adapter is DiscoverCapable {
  return typeof adapter.discover === 'function';
}

export function canRefresh(adapter: ISourceAdapter): adapter is RefreshCapable {
  return typeof adapter.refresh === 'function';
}

export function canLatest(adapter: ISourceAdapter): adapter is LatestCapable {
  return typeof adapter.latest === 'function';
}
