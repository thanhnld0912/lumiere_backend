import { sourceRegistry } from '../core/registry/SourceRegistry.js';
import { NovelUpdatesAdapter } from './novelupdates/NovelUpdatesAdapter.js';

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

  sourceRegistry.register(new NovelUpdatesAdapter());
  // sourceRegistry.register(new RoyalRoadAdapter());
  // sourceRegistry.register(new ScribbleHubAdapter());

  registered = true;
}

export { NovelUpdatesAdapter };
export { sourceRegistry };
