# Lumiere Crawler

Module thu thập dữ liệu, **độc lập hoàn toàn** với REST API. Hai bên chỉ gặp nhau
ở tầng database.

```
GitHub Actions ──> Crawler CLI ──> PostgreSQL <── REST API <── Frontend
   (cron)          (Node 20)        (Supabase)     (Vercel)      (Vite)
                        │                              │
                        └──── không gọi nhau ──────────┘
```

---

## 1. Kiến trúc

### 1.1 Pipeline

```
  ADAPTER ──────────────> IMPORTER ──────────> REPOSITORY ──> PostgreSQL
  (lấy + chuẩn hoá)       (1 novel = 1 tx)     (nơi DUY NHẤT có SQL)
       │
       ├── nguồn HTML : CheerioCrawler -> parser (selector) -> normalizer
       └── nguồn API  : fetch JSON     -----------------------> normalizer
```

Adapter trả **dữ liệu đã chuẩn hoá** (`NormalizedNovel`), không phải dữ liệu thô.
Cách nó lấy được là chuyện riêng của nó — đó là lý do một nguồn HTML và một nguồn
REST API cùng dùng chung mọi tầng phía trên.

### 1.2 Tầng

| Tầng | Trách nhiệm | **Cấm** |
|---|---|---|
| `extractors/` | hàm thuần: chuỗi → giá trị | I/O, DOM, biết site nào |
| `parsers/` | DOM một loại trang → DTO thô | network, DB |
| `crawlers/` | adapter: HTTP + chuẩn hoá | SQL, gọi repository |
| `importers/` | DTO → repository, trong transaction | viết SQL trực tiếp |
| `repositories/` | **viết SQL** | biết Crawlee là gì |
| `jobs/` | **chỉ điều phối** — gọi Adapter + Importer | parse HTML, SQL, repository |
| `scheduler/` | quyết định crawl cái gì, nhịp bao lâu | crawl |
| `cli/` | entry cho người và cho cron | logic nghiệp vụ |

### 1.3 Ba mode

| Mode | Làm gì | Ghi gì | Nhịp | Chi phí |
|---|---|---|---|---|
| `latest` | đọc feed chương mới | **chỉ** `chapters` + `sync_events` | 6 giờ | 1 request / hàng chục novel |
| `refresh` | nạp metadata + **toàn bộ mục lục** | `novels` + 6 bảng liên quan | 1 tháng | 1 + N request / novel |
| `discover` | duyệt danh mục tìm novel mới | **không ghi gì** | chạy tay | nhiều request |

### Mục lục đầy đủ chỉ lấy ở `refresh`

`refresh` gọi thêm `/stories/{id}/chapters` và duyệt hết phân trang (50 chương/trang,
trần 40 trang = 2.000 chương). Truyện 300 chương tốn 6 request — đó là lý do việc
này chỉ làm hàng tháng, không làm ở `latest`.

`NormalizedNovel.chapters` rỗng nghĩa là **"nguồn không cho mục lục"**, khác hẳn
"novel không có chương nào". Importer chỉ ghi khi mảng có phần tử, nên một lượt
`latest` (chỉ biết chương mới nhất) không xoá mất mục lục mà `refresh` đã dựng.

Kiểm tra độ đầy đủ bất cứ lúc nào:

```bash
npm run chapter-gap     # so total_chapters nguồn báo với số dòng thực trong DB
```

**Vì sao `latest` không cập nhật metadata:** feed chỉ cho biết chương nào vừa ra —
không có genre, không có mô tả, không có rating. Ghi vào `novels` sẽ đè dữ liệu
đầy đủ bằng một bản ghi thiếu thốn.

**Vì sao `discover` không ghi gì:** trang danh mục chỉ có tiêu đề và ảnh bìa.

Cả hai mode đó thay vào đó **đưa novel vào hàng đợi refresh**, và `CrawlerService`
tự chạy tiếp một lượt `refresh` ngay sau đó. Nhờ vậy một lần cron là đủ.

### 1.4 Tính idempotent

Chạy lại không tạo dữ liệu trùng, nhờ ba cơ chế:

| Cơ chế | Chống điều gì |
|---|---|
| `novel_sources.content_hash` | `refresh` chạy lại → `unchanged`, không có câu UPDATE nào chạm `novels` |
| So `chapter.number` với `MAX(number)` đang có | `latest` chạy lại → không đẻ `sync_events` trùng |
| `ON CONFLICT (novel_id, slug)` ở `chapters` | chương trùng → cập nhật, không nhân bản |

Hash được tính trên các field **có nghĩa**, cố ý bỏ `readCount`/`crawledAt`. Nếu
tính cả lượt đọc thì mọi novel sẽ bị coi là "đã thay đổi" ở mỗi lần chạy và
Timeline của người dùng thành rác.

Đo thực tế trên ScribbleHub:

```
Lần 1:  đã xem 20 · tạo mới 10 · bỏ qua 10 (đưa vào hàng đợi refresh)
Lần 2:  đã xem 10 · tạo mới  0 · không đổi 9 · cập nhật 1 (chương mới có thật)
```

---

## 2. Cron

Cron **chỉ gọi CLI**. Không có logic lập lịch nào trong code.

| Workflow | Trigger | Mode |
|---|---|---|
| `.github/workflows/crawl-latest.yml` | `cron: 0 */6 * * *` | `latest` |
| `.github/workflows/crawl-refresh.yml` | `cron: 0 3 1 * *` | `refresh` |
| `.github/workflows/crawl-discover.yml` | `workflow_dispatch` | `discover` |

Mọi workflow đều có `workflow_dispatch` để chạy tay được.

`src/scheduler/schedule.config.ts` khai báo nhịp dưới dạng **dữ liệu** — dùng để
ghi `sync_runs.next_run_at`, tức đồng hồ đếm ngược trên TimelineView. Đổi lịch
thì sửa file YAML, rồi chỉnh con số ở đây cho khớp.

### Từng workflow làm gì

```
npm ci  →  npm run build  →  npm run doctor  →  npm run crawl:<mode>
                                   │
                                   └── hỏng ⇒ DỪNG, không crawl
```

**Hỏng khi crawl** → log được lưu thành artifact (`crawl.log`, giữ 14 ngày).

**Nguồn trả 403** → CLI thoát với **mã 0**. Workflow thành công, **không retry**.
Đây là quyết định có chủ đích: bị chặn không phải sự cố hạ tầng, và thử lại chỉ
tăng nguy cơ bị cấm IP vĩnh viễn.

`concurrency` chặn hai lần cron chồng lên nhau — chạy song song sẽ tạo
`sync_events` trùng và tranh chấp trên cùng những dòng novel.

> ⚠️ GitHub **tự tắt scheduled workflow sau 60 ngày repo không có hoạt động**.
> Với cron hàng tháng thì rủi ro này là thật.

---

## 3. GitHub Secrets

| Tên | Loại | Bắt buộc | Giá trị |
|---|---|:---:|---|
| `CRAWLER_DATABASE_URL` | **Secret** | ✅ | Connection string Supabase — **session mode, port 5432** |
| `CRAWLER_USER_AGENT` | Variable | — | UA định danh kèm cách liên hệ |

Đặt tại **Settings → Secrets and variables → Actions**.

### Connection string phải đúng loại

Supabase có ba endpoint và chỉ một cái dùng được cho crawler:

| Endpoint | Dùng được? | Lý do |
|---|:---:|---|
| `…pooler.supabase.com:5432` (session) | ✅ | transaction dài OK, có IPv4 |
| `…pooler.supabase.com:6543` (transaction) | ❌ | không hỗ trợ prepared statement / advisory lock |
| `db.<ref>.supabase.co:5432` (direct) | ❌ | **IPv6-only** → `ENOTFOUND` trên runner |

Nhanh nhất: copy `DATABASE_URL` của backend rồi **đổi `6543` → `5432`**.
Username của pooler có dạng `postgres.<project-ref>`.

---

## 4. Chạy local

```bash
cd crawler
npm install
cp .env.example .env      # điền CRAWLER_DATABASE_URL
npm run doctor            # kiểm tra kết nối + migration + công thức sort_index
```

`doctor` phải xanh trước khi làm gì khác. Nó kiểm tra kết nối, xác nhận cả ba
migration đã chạy, và **đối chiếu công thức `sort_index` giữa TypeScript với
Postgres** — hai nơi đó trôi khỏi nhau thì thứ tự chương sẽ sai tuỳ theo dòng do
crawler ghi hay do trigger điền.

### Lệnh

```bash
npm run crawl:latest                 # feed chương mới
npm run crawl:refresh                # nạp metadata novel cũ nhất
npm run crawl:discover               # duyệt danh mục

npm run crawl -- --mode refresh --id 2441502
npm run crawl -- --mode refresh --id=2441502          # cả hai dạng đều được
npm run crawl -- --mode latest --limit 5 --dry-run    # không ghi database
npm run crawl -- --mode refresh --force               # bỏ qua content_hash

npm run probe -- https://www.scribblehub.com          # thăm dò nguồn mới
npm run inspect                                        # xem crawler đã ghi gì
npm run chapter-gap                                    # so số chương nguồn báo vs trong DB
npm run purge-seed                                     # xem trước dữ liệu seed sẽ xoá
npm run purge-seed -- --apply                          # thực sự xoá seed
npm test                                               # 160 test, không cần mạng
```

### Các cờ

| Cờ | Ý nghĩa |
|---|---|
| `--source <id>` | nguồn; bỏ trống → `CRAWL_DEFAULT_SOURCE` |
| `--mode <mode>` | `discover` \| `refresh` \| `latest` |
| `--limit <n>` | trần số item cho lần chạy |
| `--id <externalId>` | chỉ crawl novel này (lặp lại được) |
| `--url <url>` | như `--id` nhưng nhận URL |
| `--dry-run` | crawl + chuẩn hoá nhưng **không ghi** |
| `--force` | ghi lại bất kể `content_hash` |
| `--json` | in JSON thay vì bảng |

### `--force` dùng khi nào

Khi bạn **sửa bug ở đường ghi của crawler**. `content_hash` chỉ phản ánh dữ liệu
nguồn, nên bug của chính mình sẽ không tự lành — hash không đổi thì import bị bỏ
qua và dữ liệu sai nằm lại vĩnh viễn.

---

## 5. Chạy tay trên GitHub

**Actions** → chọn workflow → **Run workflow**. Tham số:

| Tham số | Có ở | Mặc định |
|---|---|---|
| `source` | cả ba | `CRAWL_DEFAULT_SOURCE` |
| `limit` | cả ba | 100 / 1000 / 200 |
| `force` | chỉ `refresh` | `false` |

---

## 6. Thêm nguồn mới

### Bước 0 — thăm dò TRƯỚC khi viết code

```bash
npm run probe -- https://example.com
```

Script gửi vài request tới `robots.txt`, `/feed/`, `/wp-json/`, `/` với hai loại
định danh, rồi kết luận nguồn có cho truy cập tự động không, và nếu chặn thì chặn
theo User-Agent hay theo IP.

**Bước này không được bỏ qua.** NovelUpdates đã được viết adapter đầy đủ, test
xanh 121/121, rồi mới phát hiện site trả 403 cho *mọi* endpoint kể cả `robots.txt`.

Thứ tự ưu tiên giao diện: **REST API → RSS → HTML**. API có hợp đồng ổn định và
không có selector nào để hỏng.

### Bước 1–4 — viết adapter

```
1. crawler/src/config/sources/<nguồn>.config.ts     — baseUrl, politeness, paths
2. thêm 1 dòng vào config/sources/index.ts
3. crawler/src/crawlers/<nguồn>/
     ├── types.ts        (nguồn API) hoặc parsers/<nguồn>/  (nguồn HTML)
     ├── mappings.ts     vựng từ của nguồn → vựng từ Lumiere
     ├── <Nguồn>Normalizer.ts
     └── <Nguồn>Adapter.ts   extends BaseApiCrawler | BaseCrawler
4. thêm 1 dòng `register(...)` vào crawlers/index.ts
```

**Không phải sửa file nào khác.** Không migration (crawler tự đăng ký nguồn vào
bảng `sources`), không đụng `core/`, `dto/`, `database/`, `jobs/`, `cli/`.

Đó là bài kiểm tra thật của kiến trúc — nếu phải sửa tầng khác thì thiết kế đã sai.

### Chọn lớp cha nào

| Nguồn | Lớp cha | Ví dụ |
|---|---|---|
| REST API / JSON | `BaseApiCrawler` | ScribbleHub |
| HTML | `BaseCrawler` (CheerioCrawler) | NovelUpdates |

### Ba điều bắt buộc trong normalizer

1. **Không bịa dữ liệu.** Nguồn không nói gì về trạng thái → `Unknown`, không đoán
   `Ongoing`. Không có tên chương → `Chapter 12`, không thêm dấu hai chấm trống.
2. **Hash bỏ field biến động.** Lượt đọc, thời điểm crawl không được vào
   `contentHash`.
3. **Ép về ràng buộc DB.** `rating` kẹp `[0,5]` (`numeric(3,2)`), slug thoả
   `^[a-z0-9]+(-[a-z0-9]+)*$`.

---

## 7. Trạng thái các nguồn

| Nguồn | Trạng thái | Ghi chú |
|---|---|---|
| **ScribbleHub** | ✅ đang dùng | REST API chính thức, 130 route, không cần token |
| **NovelUpdates** | ⛔ bị chặn | 403 ở **mọi** endpoint kể cả `robots.txt`. Code giữ nguyên, test vẫn xanh |
| RoyalRoad | ⚪ chưa làm | `robots.txt` cho phép `*`, nhưng chặn hàng loạt crawler AI |

Chi tiết đo đạc: [CRAWLER_ARCHITECTURE.md](../CRAWLER_ARCHITECTURE.md) §11–§12.

---

## 8. Khắc phục sự cố

| Triệu chứng | Nguyên nhân & xử lý |
|---|---|
| `getaddrinfo ENOTFOUND db.<ref>.supabase.co` | Direct connection là IPv6-only. Dùng host pooler port 5432. |
| `password authentication failed` | Username pooler là `postgres.<ref>`, không phải `postgres`. |
| `Database schema is not initialised` | Chưa chạy `npm run db:migrate` ở thư mục backend. |
| `bind message supplies N parameters…` | Sai parameter mapping. Guard trong `database/pool.ts` sẽ chỉ thẳng câu SQL. |
| Nguồn trả 403 | CLI thoát mã 0, không retry. Chạy `npm run probe` từ mạng khác để phân định IP hay client. |
| Dữ liệu sai nhưng crawl báo `không đổi` | Bug ở đường ghi — `content_hash` không tự lành. Chạy lại với `--force`. |
| Tiến trình treo sau khi in kết quả | `pg.Pool` giữ event loop. CLI đã gọi `closePool()` ở mọi nhánh thoát. |
