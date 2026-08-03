# Fixture HTML — NovelUpdates

Đây là **hạ tầng test quan trọng nhất** của module crawler.

Parser là hàm thuần trên chuỗi HTML, nên có fixture nghĩa là test được toàn bộ tầng parse
**không cần mạng, không cần database**. Và khi NovelUpdates đổi layout, chỉ cần thay fixture là
biết ngay parser nào gãy — thay vì phát hiện sau khi crawler đã ghi vài nghìn bản ghi rỗng.

---

## Cần những file nào

| Tên file | Loại trang | Dùng để test |
|---|---|---|
| `series-ongoing.html` | Trang series, trạng thái **Ongoing** | `NovelUpdatesSeriesParser` — ca phổ biến nhất |
| `series-completed.html` | Trang series, trạng thái **Completed** | mapping trạng thái khác + tổng số chương |
| `series-edge-cases.html` | Trang series "khó" | thiếu field, tên khác nhiều thứ tiếng, nhiều tác giả |
| `browse-page1.html` | Trang danh mục / ranking | `NovelUpdatesBrowseParser` — mode `discover` + phân trang |
| `latest-releases.html` | Trang latest releases | `NovelUpdatesLatestParser` — mode `latest`, quan trọng nhất |

**Gợi ý cho `series-edge-cases.html`:** chọn một series có nhãn chương lạ — `v5c243`,
`c243.5`, `Extra Chapter 12`, `ss1`, hoặc `c100-102`. Đó chính là những ca mà
`chapter.extractor` phải xử lý đúng, và có fixture thật thì mới chắc được.

---

## Cách lưu

### Cách 1 — PowerShell (khuyến nghị)

Lấy đúng HTML thô mà server trả về, tức **chính xác thứ CheerioCrawler sẽ nhận**:

```powershell
cd E:\Code\Lumiere_backend\crawler\tests\fixtures\novelupdates

$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

Invoke-WebRequest -Uri '<URL-series-ongoing>'   -UserAgent $ua -OutFile 'series-ongoing.html'
Invoke-WebRequest -Uri '<URL-series-completed>' -UserAgent $ua -OutFile 'series-completed.html'
Invoke-WebRequest -Uri '<URL-series-la>'        -UserAgent $ua -OutFile 'series-edge-cases.html'
Invoke-WebRequest -Uri '<URL-browse>'           -UserAgent $ua -OutFile 'browse-page1.html'
Invoke-WebRequest -Uri 'https://www.novelupdates.com/' -UserAgent $ua -OutFile 'latest-releases.html'
```

### Cách 2 — lưu từ trình duyệt

`Ctrl+S` → chọn **"Webpage, HTML Only"**.

> ⚠️ **Đừng chọn "Webpage, Complete".** Chế độ đó tải kèm ảnh/CSS và **viết lại đường dẫn**
> thành local, làm hỏng test của `toAbsoluteUrl` và `extractPathSlug` — hai hàm phụ thuộc vào
> URL gốc để sinh `external_id`.

---

## Sau khi lưu: cập nhật `manifest.json`

Parser nhận `ParseContext.url` để resolve link tương đối và tách `external_id`. Test cần biết
mỗi file gốc là URL nào, nên **bắt buộc** điền `manifest.json` cùng thư mục này.

---

## Nếu lỡ lưu trang `view-source:`

Trình duyệt sẽ lưu lớp bọc tô màu cú pháp của Chrome (`<td class="line-content">`, `&lt;`…)
thay vì HTML thật. Gỡ bằng:

```bash
node scripts/unwrap-view-source.mjs tests/fixtures/novelupdates
```

Script idempotent — file đã là HTML thường thì bỏ qua. Thực ra `view-source:` là nguồn **tốt
nhất**: nó hiển thị đúng response thô từ server, tức chính xác thứ CheerioCrawler nhận, trong
khi "Save page" của trình duyệt lưu DOM sau khi JavaScript đã chạy.

---

## Những điều fixture hiện tại cho biết

| Phát hiện | Hệ quả |
|---|---|
| Bảng latest releases **render sẵn từ server** (`table#myTable.tablesorter`) | CheerioCrawler đủ dùng, **không cần Playwright** — giữ nguyên `requiresJavaScript: false` |
| Tiêu đề trong bảng latest **bị cắt ngắn**, bản đầy đủ nằm ở attribute `title` | Parser phải đọc attribute, không đọc text |
| Bảng latest **không có cột thời gian** | `RawLatestRelease.releasedAt` sẽ là `null`; `last_chapter_at` phải lấy từ trang series hoặc dùng thời điểm crawl |
| Trường "Language" của NU là **ngôn ngữ GỐC** (Chinese/Korean/Japanese), không phải ngôn ngữ bản dịch | `novels.language` sẽ chứa 'Chinese'; D3 "English only" phải lọc bằng tiêu chí khác |

---

## Ghi chú

- File HTML của NovelUpdates khoảng 200–400 KB. Năm file là ~1–2 MB, commit vào git bình thường.
- Nếu repo là **public**, cân nhắc: đây là HTML của bên thứ ba lưu lại làm fixture test. Muốn
  tránh thì thêm thư mục này vào `.gitignore` và giữ script tải lại ở trên — đổi lại là CI sẽ
  phải có mạng.
- **Đừng chỉnh sửa tay** nội dung file. Fixture phải phản ánh đúng những gì site trả về; sửa tay
  sẽ khiến test qua trong khi parser thực tế vẫn hỏng.
