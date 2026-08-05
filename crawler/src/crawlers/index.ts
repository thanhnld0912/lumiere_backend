import { sourceRegistry } from '../core/registry/SourceRegistry.js';
import { NovelUpdatesAdapter } from './novelupdates/NovelUpdatesAdapter.js';
import { ScribbleHubAdapter } from './scribblehub/ScribbleHubAdapter.js';

/**
 * Nơi DUY NHẤT biết những Source Adapter cụ thể nào đang tồn tại.
 *
 * Thêm nguồn mới = thêm đúng một dòng `register(...)` ở đây và một thư mục
 * trong `crawlers/`. Không tầng nào khác phải sửa — đó là bài kiểm tra thật sự
 * cho tính mở rộng.
 *
 * Adapter import registry (không phải ngược lại) để tránh phụ thuộc vòng.
 */
let registered = false;

export function registerSourceAdapters(): void {
  if (registered) return;

  /*
   * ScribbleHub đứng trước vì đây là nguồn ĐANG DÙNG ĐƯỢC (REST API chính thức).
   *
   * NovelUpdates vẫn đăng ký để code không bị mục, nhưng hiện trả 403 cho mọi
   * request — xem §11 của CRAWLER_ARCHITECTURE.md. Gọi nó sẽ dừng ngay với
   * BlockedError thay vì thử lại.
   */
  sourceRegistry.register(new ScribbleHubAdapter());
  sourceRegistry.register(new NovelUpdatesAdapter());
  // sourceRegistry.register(new RoyalRoadAdapter());

  registered = true;
}

export { NovelUpdatesAdapter, ScribbleHubAdapter };
export { sourceRegistry };
