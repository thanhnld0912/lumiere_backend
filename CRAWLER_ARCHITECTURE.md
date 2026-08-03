# CRAWLER_ARCHITECTURE.md

> **Thiết kế kiến trúc — chưa sinh code.**
> Module crawler độc lập hoàn toàn với REST API. Không sửa API, controller, hay frontend.

---

## 0. TÓM TẮT — ĐỌC TRƯỚC

Ba điều quyết định toàn bộ thiết kế bên dưới. Hai trong số đó là **rào chắn**, không phải lựa chọn.

### 🔴 R1 — Crawler KHÔNG được nằm trong dependency tree của Vercel

`vercel.json` hiện tại không có `builds`, nên Vercel tự dò và cài **toàn bộ `dependencies` ở
root `package.json`**. Crawlee kéo theo Playwright + Chromium (~300MB+). Nếu để chung, mọi
deploy backend sẽ chậm đi hàng phút, và nhiều khả năng vượt luôn giới hạn 250MB unzipped của
Vercel serverless function → **API đang chạy sẽ chết**.

→ **Crawler phải là một npm package RIÊNG** (`crawler/package.json`, `crawler/node_modules`),
**cố ý KHÔNG dùng npm workspaces** — vì workspace sẽ khiến `npm install` ở root kéo cả Crawlee về.
Cộng thêm `.vercelignore` để chặn ở tầng thứ hai.

Đây là ràng buộc số một. Mọi thứ khác trong tài liệu này đều xoay quanh nó.

### 🔴 R2 — 5/17 field anh muốn crawl KHÔNG có chỗ trong schema hiện tại

| Field | Schema hiện tại | Cần làm |
|---|---|---|
| Title, Slug, Cover, Author, Genres, Status, Description, Rating | ✅ có | — |
| Latest chapter | ⚠️ có bảng `chapters` nhưng chưa có đường vào | quyết định D3 |
| Translator Group | ✅ `translation_groups` | — |
| **Alternative names** | ❌ | bảng `novel_alt_titles` |
| **Language** | ❌ | cột `novels.language` |
| **Tags** | ❌ (chỉ có `genres`) | bảng `tags` + `novel_tags` |
| **Original Publisher** | ❌ | cột `novels.original_publisher` |
| **NovelUpdates URL** | ❌ | `novel_sources.source_url` |

Thêm nữa, để "mở rộng cho hàng trăm site" thì bắt buộc phải có **`sources` + `novel_sources`** —
nếu không sẽ không biết một novel đến từ đâu, không dedupe được across-site, và không phát hiện
được thay đổi. Đây là quyết định kiến trúc quan trọng nhất về mặt dữ liệu.

→ Cần **một migration** trước khi viết bất kỳ dòng crawler nào. Chi tiết ở §5.

### 🟢 R3 — Crawler khép kín vòng lặp cho tính năng Timeline đang chết

`sync_events` và `sync_runs` đã có sẵn trong schema và đang phục vụ `GET /api/timeline` +
`GET /api/timeline/stats`, nhưng hiện chỉ có dữ liệu seed tĩnh. Crawler chính là thứ sinh ra
dữ liệu thật cho hai bảng đó.

Nghĩa là: **crawler không cần API mới nào cả.** Nó ghi vào DB, API đọc ra. Đúng tinh thần
"hoàn toàn cô lập" mà anh yêu cầu — hai tiến trình chỉ gặp nhau ở tầng database.

```
GitHub Actions ──> Crawler CLI ──> PostgreSQL <── REST API <── Frontend
   (cron)          (Node 20)        (Supabase)     (Vercel)      (Vite)
                        │                              │
                        └──── không gọi nhau ──────────┘
```

---

## 1. FOLDER STRUCTURE

```
Lumiere_backend/
│
├── api/                              # ⛔ KHÔNG ĐỔI — Vercel entry
├── src/                              # ⛔ KHÔNG ĐỔI — REST API
│
├── database/
│   ├── schema.sql                    # ⛔ KHÔNG ĐỔI
│   ├── seed.sql                      # ⛔ KHÔNG ĐỔI
│   └── migrations/
│       └── 001_crawler_support.sql   # 🆕 bảng + cột cho crawler
│
├── .vercelignore                     # 🆕 chặn crawler/ khỏi bundle Vercel
├── .github/
│   └── workflows/
│       └── crawl.yml                 # 🆕 scheduler
│
└── crawler/                          # 🆕 PACKAGE ĐỘC LẬP (node_modules riêng)
    ├── package.json
    ├── tsconfig.json
    ├── .env.example
    ├── .gitignore
    ├── README.md
    │
    ├── tests/
    │   └── fixtures/
    │       └── novelupdates/         # HTML lưu sẵn -> test parser không cần mạng
    │
    └── src/
        │
        ├── config/                   # cấu hình, không phụ thuộc gì
        │   ├── env.ts
        │   ├── crawler.config.ts
        │   └── sources/
        │       ├── types.ts
        │       ├── novelupdates.config.ts
        │       └── index.ts          # SOURCE_CONFIGS registry
        │
        ├── core/                     # abstraction thuần — KHÔNG biết site nào, KHÔNG biết SQL
        │   ├── types.ts
        │   ├── contracts/
        │   │   ├── ICrawler.ts
        │   │   ├── IParser.ts
        │   │   ├── IExtractor.ts
        │   │   ├── INormalizer.ts
        │   │   ├── IImporter.ts
        │   │   ├── IJob.ts
        │   │   └── index.ts
        │   ├── BaseCrawler.ts
        │   ├── pipeline/
        │   │   └── CrawlPipeline.ts
        │   ├── registry/
        │   │   └── SourceRegistry.ts
        │   ├── errors/
        │   │   ├── CrawlerError.ts
        │   │   ├── ParseError.ts
        │   │   ├── ImportError.ts
        │   │   └── index.ts
        │   └── result/
        │       ├── CrawlResult.ts
        │       └── RunSummary.ts
        │
        ├── dto/                      # hợp đồng dữ liệu giữa các tầng
        │   ├── RawNovel.dto.ts
        │   ├── RawLatestRelease.dto.ts
        │   ├── NormalizedNovel.dto.ts
        │   ├── NormalizedChapterRef.dto.ts
        │   ├── ImportOutcome.dto.ts
        │   ├── CrawlRun.dto.ts
        │   └── index.ts
        │
        ├── extractors/               # HÀM THUẦN — string/Cheerio -> giá trị. Không I/O.
        │   ├── text.extractor.ts
        │   ├── list.extractor.ts
        │   ├── rating.extractor.ts
        │   ├── status.extractor.ts
        │   ├── chapter.extractor.ts
        │   ├── date.extractor.ts
        │   ├── url.extractor.ts
        │   └── index.ts
        │
        ├── parsers/                  # DOM của MỘT loại trang -> RawDto. Không I/O, không DB.
        │   └── novelupdates/
        │       ├── selectors.ts
        │       ├── NovelUpdatesSeriesParser.ts
        │       ├── NovelUpdatesBrowseParser.ts
        │       ├── NovelUpdatesLatestParser.ts
        │       └── index.ts
        │
        ├── crawlers/                 # điều phối Crawlee + routing. Không DB.
        │   ├── novelupdates/
        │   │   ├── NovelUpdatesCrawler.ts
        │   │   ├── routes.ts
        │   │   ├── mappings.ts
        │   │   └── index.ts
        │   └── index.ts
        │
        ├── normalizers/              # RawDto -> NormalizedDto (canonical). Không DB.
        │   ├── NovelNormalizer.ts
        │   ├── ChapterRefNormalizer.ts
        │   ├── SlugGenerator.ts
        │   ├── TextSanitizer.ts
        │   ├── ContentHasher.ts
        │   └── index.ts
        │
        ├── database/                 # kết nối. Pool RIÊNG, không dùng chung với API.
        │   ├── pool.ts
        │   ├── transaction.ts
        │   ├── rows.ts
        │   └── index.ts
        │
        ├── repositories/             # ⭐ NƠI DUY NHẤT ĐƯỢC VIẾT SQL
        │   ├── BaseRepository.ts
        │   ├── SourceRepository.ts
        │   ├── NovelRepository.ts
        │   ├── ChapterRepository.ts
        │   ├── GenreRepository.ts
        │   ├── TagRepository.ts
        │   ├── TranslationGroupRepository.ts
        │   ├── SyncRepository.ts
        │   └── index.ts
        │
        ├── importers/                # NormalizedDto -> repositories, trong 1 transaction
        │   ├── NovelImporter.ts
        │   ├── ChapterRefImporter.ts
        │   └── index.ts
        │
        ├── services/                 # điều phối nghiệp vụ
        │   ├── CrawlerService.ts
        │   ├── UpdateDetectionService.ts
        │   ├── DeduplicationService.ts
        │   ├── PolitenessService.ts
        │   └── index.ts
        │
        ├── jobs/                     # đơn vị công việc chạy được
        │   ├── DiscoverNovelsJob.ts
        │   ├── RefreshNovelsJob.ts
        │   ├── DetectUpdatesJob.ts
        │   └── index.ts
        │
        ├── scheduler/                # entry cho GitHub Actions
        │   ├── schedule.config.ts
        │   ├── RunPlanner.ts
        │   └── runScheduled.ts
        │
        ├── cli/                      # entry cho người
        │   ├── index.ts
        │   ├── args.ts
        │   └── commands/
        │       ├── crawl.command.ts
        │       └── sources.command.ts
        │
        └── utils/
            ├── logger.ts
            ├── retry.ts
            ├── hash.ts
            ├── slugify.ts
            ├── sleep.ts
            ├── chunk.ts
            └── index.ts
```

**Sai khác so với sketch của anh:** tôi tách thêm `normalizers/`, `dto/`, `cli/`.
Lý do: normalize là một **stage riêng** trong pipeline (parse → normalize → import). Nhét nó vào
`services/` hay `core/` sẽ che mất ranh giới đó, và đây chính là chỗ dễ phát sinh bug nhất khi
thêm site thứ hai — nó phải nhìn thấy được.

---

## 2. ARCHITECTURE EXPLANATION

### 2.1 Pipeline — 5 stage, mỗi stage một trách nhiệm

```
   ┌──────────┐   HTML    ┌────────┐  RawNovel  ┌────────────┐ NormalizedNovel ┌──────────┐   ┌──────────────┐
   │ CRAWLER  │ ────────> │ PARSER │ ─────────> │ NORMALIZER │ ──────────────> │ IMPORTER │──>│ REPOSITORIES │
   └──────────┘           └────────┘            └────────────┘                 └──────────┘   └──────────────┘
    Crawlee                Cheerio               thuần                          transaction    SQL
    HTTP, retry,           selectors,            mapping, slug,                 upsert         (nơi DUY NHẤT)
    rate limit,            dùng extractors       hash, sanitize
    routing                                            │
                                ▲                      │
                                │                      │
                          ┌───────────┐          ┌───────────┐
                          │EXTRACTORS │          │  UPDATE   │
                          │ hàm thuần │          │ DETECTION │
                          └───────────┘          └───────────┘
```

Quy tắc bất di bất dịch, và đây là thứ giữ cho hệ thống mở rộng được:

| Tầng | ĐƯỢC | KHÔNG ĐƯỢC |
|---|---|---|
| `extractors/` | nhận string, trả giá trị | I/O, DOM query, biết site nào |
| `parsers/` | đọc DOM bằng selector, gọi extractor | network, DB, side effect |
| `crawlers/` | HTTP qua Crawlee, routing, gọi parser | SQL, gọi repository |
| `normalizers/` | biến đổi dữ liệu thuần | I/O |
| `importers/` | gọi repository trong transaction | viết SQL trực tiếp |
| `repositories/` | **viết SQL** | biết Crawlee là gì |

> **Cách kiểm chứng tự động:** thêm một bước CI grep tìm `SELECT|INSERT|UPDATE|DELETE` trong
> `crawler/src/` ngoài `repositories/`. Vi phạm là fail build. Quy ước không được enforce sẽ bị
> phá vỡ trong vòng ba tháng.

### 2.2 Vì sao tách `parsers` và `extractors`

Đây là chỗ dễ làm sai nhất, nên nói rõ:

- **Extractor** = hàm thuần, không biết trang nào. `parseRating("4.2 / 5 from 1,234 ratings")`
  → `{ rating: 4.2, count: 1234 }`. Dùng lại được cho **mọi** site.
- **Parser** = biết cấu trúc DOM của **một loại trang cụ thể**. Nó lấy chuỗi thô ra khỏi DOM rồi
  giao cho extractor.

Lợi ích thực tế: khi NovelUpdates đổi HTML, **chỉ `selectors.ts` và parser phải sửa**. Toàn bộ
logic phân tích chuỗi (vốn là phần khó và nhiều edge case nhất) không đụng tới. Và extractor test
được bằng unit test thuần, không cần mạng.

### 2.3 Abstraction — Crawler → NovelUpdatesCrawler → FutureCrawler

```ts
// core/contracts/ICrawler.ts  (chỉ là hình dạng, chưa phải code cuối)
interface ICrawler {
  readonly sourceId: string;
  supports(mode: CrawlMode): boolean;
  run(ctx: CrawlContext): Promise<CrawlResult<RawNovel>>;
}

// core/BaseCrawler.ts — lo phần chung: dựng CheerioCrawler, áp config politeness,
// gắn logger, gom lỗi, đếm số liệu. Lớp con chỉ khai báo route + parser.
abstract class BaseCrawler implements ICrawler { ... }

// crawlers/novelupdates/NovelUpdatesCrawler.ts
class NovelUpdatesCrawler extends BaseCrawler { ... }
```

`SourceRegistry` ánh xạ `sourceId → { crawler, normalizer, config }`. **Thêm site mới = thêm một
entry vào registry + một thư mục trong `crawlers/` và `parsers/`. Không sửa bất cứ file nào đang có.**
Đó là bài kiểm tra thật sự cho tính mở rộng, và Phase 11 (§4) tồn tại để chứng minh nó.

### 2.4 Ba chế độ crawl — không phải một

Crawler cấp doanh nghiệp không có "một hàm crawl". Ít nhất ba chế độ, tần suất khác nhau:

| Mode | Làm gì | Tần suất | Chi phí |
|---|---|---|---|
| `discover` | duyệt trang browse/sitemap tìm novel **mới** | hàng tuần | cao |
| `refresh` | crawl lại metadata novel **đã biết** (rating, status, tags đổi) | hàng ngày, theo độ cũ | trung bình |
| `latest` | đọc feed "latest releases" để bắt chương mới | mỗi 3–6 giờ | **rất thấp** |

`latest` là chế độ chạy thường xuyên nhất và rẻ nhất — một trang duy nhất cho biết hàng trăm
novel vừa có chương mới. `RunPlanner` chọn novel để refresh theo
`novel_sources.last_crawled_at` cũ nhất, có giới hạn ngân sách mỗi lần chạy.

### 2.5 Duplicate detection — hai tầng khác nhau

Rất dễ nhầm hai thứ này làm một:

1. **Trùng URL trong một lần chạy** — Crawlee giải quyết sẵn bằng `RequestQueue` + `uniqueKey`.
   Không cần tự viết.
2. **Trùng thực thể qua các lần chạy / qua các site** — đây mới là việc của mình
   (`DeduplicationService`), theo thứ tự ưu tiên:

   ```
   a. (source_id, external_id)  -> khớp chắc chắn, dùng novel_sources
   b. slug đã chuẩn hoá         -> khớp chắc chắn
   c. normalized title + author -> khớp có khả năng cao
   d. alternative title khớp    -> khớp có khả năng   ── (c) và (d) KHÔNG tự động merge:
                                                          ghi vào bảng chờ người duyệt
   ```

   Bước (c)/(d) tự động merge là cách nhanh nhất để hỏng dữ liệu — hai light novel khác nhau
   hoàn toàn có thể trùng tiêu đề tiếng Anh. Giai đoạn đầu chỉ cần (a) và (b).

### 2.6 Update detection — hash trước, ghi sau

```
RawNovel ──> normalize ──> NormalizedNovel ──> ContentHasher.hash()
                                                      │
                                    ┌─────────────────┴─────────────────┐
                                    │  so với novel_sources.content_hash │
                                    └─────────────────┬─────────────────┘
                                                      │
                        ┌─────────────────────────────┼──────────────────────────┐
                        │                             │                          │
                   không đổi                     đã đổi                    chưa từng thấy
                        │                             │                          │
              chỉ update last_crawled_at      UPDATE + ghi sync_event         INSERT
              (1 câu UPDATE, không đụng        (novel thật sự thay đổi)
               bảng novels)
```

Vì sao quan trọng: đa số lần refresh sẽ cho ra dữ liệu **y hệt**. Không hash thì mỗi lần chạy sẽ
`UPDATE` toàn bộ vài nghìn dòng, đẩy `updated_at` nhảy loạn, và làm `sync_events` đầy rác khiến
Timeline của người dùng vô nghĩa.

**Chapter comparison** tách riêng khỏi hash metadata: so `latestChapter.number` mới với
`MAX(chapters.number)` đang có. Lớn hơn → chèn chương thiếu + ghi `sync_events` với
`chapters_added_count` = phần chênh. Đây chính là nguồn dữ liệu cho `GET /api/timeline`.

### 2.7 Retry / rate limit / throttling — dùng Crawlee, đừng tự viết lại

Crawlee đã có sẵn, chỉ cần **cấu hình đúng** trong `sources/*.config.ts`:

| Yêu cầu | Cơ chế |
|---|---|
| Retry | `maxRequestRetries` + exponential backoff của Crawlee |
| Rate limit | `maxRequestsPerMinute` |
| Throttling | `maxConcurrency` + autoscaled pool |
| Lỗi vĩnh viễn | `failedRequestHandler` → ghi log + `CrawlResult.failed`, **không** làm chết run |
| Session/cookie | `SessionPool` |

`utils/retry.ts` **chỉ** dùng cho thao tác ngoài Crawlee (ví dụ ghi DB gặp deadlock). Không dùng
cho HTTP.

`PolitenessService` là lớp mỏng bổ sung Crawlee **không** làm: kiểm tra `robots.txt`, đặt
`User-Agent` định danh rõ ràng có kèm contact, và giữ khoảng cách tối thiểu giữa các request tới
cùng host. Crawl chậm và có định danh là cách rẻ nhất để không bị chặn IP — với GitHub Actions
IP dùng chung thì bị chặn là hỏng vĩnh viễn.

### 2.8 Vì sao crawler có pool database RIÊNG

`crawler/src/database/pool.ts` **không** import từ `src/config/database.ts`. Hai lý do:

1. **Cô lập** — anh yêu cầu crawler độc lập. Import chéo là phá vỡ điều đó, và sẽ kéo cả cây
   phụ thuộc của API vào crawler.
2. **Tuning ngược nhau.** API chạy serverless: `max: 1`, đời sống ngắn, transaction pooler
   (6543). Crawler chạy batch: pool lớn hơn, transaction dài, **bắt buộc direct connection
   (5432)** — transaction pooler của Supabase không giữ được transaction xuyên suốt nhiều câu
   lệnh một cách tin cậy.

Ghi/đọc cũng tách vai: **crawler chỉ ghi, API chỉ đọc.** Không có chuyện tranh chấp logic.

---

## 3. EVERY FILE THAT MUST BE CREATED

**Tổng: 84 file mới + 5 file có sẵn phải sửa** (hệ quả bắt buộc của D1/D2, xem §9).

### A. Thêm ở root — 7 file

| File | Mục đích |
|---|---|
| `.vercelignore` | `crawler/`, `.github/`, `tests/` — chặn khỏi bundle Vercel |
| `database/migrations/001_status_enum.sql` | D2 — **không** bọc transaction (§5.0) |
| `database/migrations/002_crawler_support.sql` | bảng + cột mới (§5.2) |
| `database/migrations/003_chapter_model.sql` | D1 — mô hình chapter (§5.3) |
| `.github/workflows/crawl-latest.yml` | mode `latest`, 6h/lần (§9.3) |
| `.github/workflows/crawl-refresh.yml` | mode `refresh`, 1 tháng/lần — đúng D4 |
| `.github/workflows/crawl-discover.yml` | mode `discover`, `workflow_dispatch` thủ công |

> `package.json` root **không** đổi. Đó là điểm mấu chốt của R1.

### A2. File CÓ SẴN buộc phải sửa — 5 file

Đây là hệ quả trực tiếp của D1 và D2, không tránh được. Tất cả đều là sửa nhỏ, không đổi shape JSON:

| File | Sửa gì | Vì |
|---|---|---|
| `Lumiere_frontend/src/types.ts:35` | union `status` thêm `'Dropped' \| 'Unknown'` | D2 |
| `Lumiere_backend/src/models/index.ts` | `NovelStatus` thêm 2 giá trị | D2 |
| `Lumiere_backend/src/schemas/novel.schema.ts` | `novelQuerySchema.status` thêm 2 giá trị | D2 |
| `Lumiere_backend/src/services/novel.service.ts` | `ORDER BY number ASC` → `sort_index` | D1 (§9.1) |
| `Lumiere_frontend/src/components/DiscoverView.tsx:80` | *(tuỳ chọn)* thêm `Dropped` vào bộ lọc | D2 |

**Không** controller nào bị sửa. **Không** endpoint nào đổi shape.

### B. crawler/ root — 5 file

`package.json` · `tsconfig.json` · `.env.example` · `.gitignore` · `README.md`

### C. config/ — 5 file

| File | Nội dung |
|---|---|
| `env.ts` | đọc + validate env, fail-fast (mẫu giống `src/config/env.ts` nhưng độc lập) |
| `crawler.config.ts` | mặc định toàn cục: concurrency, retry, timeout, log level |
| `sources/types.ts` | `interface SourceConfig` |
| `sources/novelupdates.config.ts` | baseUrl, paths, rate limit, politeness |
| `sources/index.ts` | `SOURCE_CONFIGS` — registry |

### D. core/ — 16 file

`types.ts` · `BaseCrawler.ts` ·
`contracts/{ICrawler,IParser,IExtractor,INormalizer,IImporter,IJob,index}.ts` ·
`pipeline/CrawlPipeline.ts` · `registry/SourceRegistry.ts` ·
`errors/{CrawlerError,ParseError,ImportError,index}.ts` ·
`result/{CrawlResult,RunSummary}.ts`

### E. dto/ — 7 file

`RawNovel.dto.ts` · `RawLatestRelease.dto.ts` · `NormalizedNovel.dto.ts` ·
`NormalizedChapterRef.dto.ts` · `ImportOutcome.dto.ts` · `CrawlRun.dto.ts` · `index.ts`

### F. extractors/ — 8 file

| File | Ví dụ đầu vào → đầu ra |
|---|---|
| `text.extractor.ts` | gom whitespace, giải HTML entity, bỏ ký tự zero-width |
| `list.extractor.ts` | `"Action, Drama, Fantasy"` → `['Action','Drama','Fantasy']` |
| `rating.extractor.ts` | `"4.2 / 5 from 1,234 ratings"` → `{ rating: 4.2, count: 1234 }` |
| `status.extractor.ts` | `"Completed (243 chapters)"` → `{ status:'Completed', total:243 }` |
| `chapter.extractor.ts` | `"v2c15 part2"` → `{ volume:2, number:15, part:2 }` |
| `date.extractor.ts` | `"2 days ago"` → `Date` (cần `now` truyền vào để test được) |
| `url.extractor.ts` | href tương đối → tuyệt đối; tách `external_id` từ URL |
| `index.ts` | re-export |

### G. parsers/novelupdates/ — 5 file

`selectors.ts` · `NovelUpdatesSeriesParser.ts` · `NovelUpdatesBrowseParser.ts` ·
`NovelUpdatesLatestParser.ts` · `index.ts`

### H. crawlers/ — 5 file

`novelupdates/{NovelUpdatesCrawler,routes,mappings,index}.ts` · `index.ts`

`mappings.ts` giữ bảng tra riêng của NovelUpdates: status của NU → `novel_status` enum,
tên ngôn ngữ → mã chuẩn.

### I. normalizers/ — 6 file

`NovelNormalizer.ts` · `ChapterRefNormalizer.ts` · `SlugGenerator.ts` · `TextSanitizer.ts` ·
`ContentHasher.ts` · `index.ts`

### J. database/ — 4 file

`pool.ts` · `transaction.ts` · `rows.ts` · `index.ts`

### K. repositories/ — 9 file

| File | Bảng phụ trách |
|---|---|
| `BaseRepository.ts` | helper transaction/query dùng chung |
| `SourceRepository.ts` | `sources`, `novel_sources` |
| `NovelRepository.ts` | `novels`, `novel_alt_titles` |
| `ChapterRepository.ts` | `chapters` (**không** đụng `chapter_contents`) |
| `GenreRepository.ts` | `genres`, `novel_genres` |
| `TagRepository.ts` | `tags`, `novel_tags` |
| `TranslationGroupRepository.ts` | `translation_groups` |
| `SyncRepository.ts` | `sync_runs`, `sync_events` |
| `index.ts` | re-export |

> Anh chỉ nêu 3 repository. Cần 7 vì các field anh muốn crawl (genres, tags, alt names, group,
> nguồn) nằm ở các bảng khác nhau — dồn hết vào `NovelRepository` sẽ biến nó thành một file
> 800 dòng chạm vào 7 bảng, đúng thứ mà kiến trúc module này muốn tránh.

### L. importers/ — 3 file

`NovelImporter.ts` · `ChapterRefImporter.ts` · `index.ts`

`NovelImporter` là nơi **một novel = một transaction**: upsert novel → alt titles → genres →
tags → group → novel_sources, commit. Một novel hỏng không kéo theo cả batch.

### M. services/ — 5 file

`CrawlerService.ts` · `UpdateDetectionService.ts` · `DeduplicationService.ts` ·
`PolitenessService.ts` · `index.ts`

### N. jobs/ — 5 file

`DiscoverNovelsJob.ts` · `RefreshNovelsJob.ts` · `DetectUpdatesJob.ts` ·
`RecomputeScoresJob.ts` *(D6 — tính `popularity_score`/`trending_score` theo batch, §10.4)* ·
`index.ts`

### O. scheduler/ — 3 file

`schedule.config.ts` · `RunPlanner.ts` · `runScheduled.ts`

### P. cli/ — 4 file

`index.ts` · `args.ts` · `commands/crawl.command.ts` · `commands/sources.command.ts`

### Q. utils/ — 7 file

`logger.ts` (pino) · `retry.ts` · `hash.ts` · `slugify.ts` · `sleep.ts` · `chunk.ts` · `index.ts`

### R. tests/fixtures/ — tối thiểu 4 file

`novelupdates/series-ongoing.html` · `series-completed.html` · `browse-page.html` ·
`latest-releases.html`

Đây là **hạ tầng test quan trọng nhất** của module: cho phép test parser mà không cần mạng, và
khi NovelUpdates đổi HTML thì chỉ cần thay fixture là biết ngay parser nào gãy.

---

## 4. IMPLEMENTATION ORDER

Nguyên tắc: **mỗi phase phải verify được độc lập**, và phase rủi ro nhất (R1) đứng đầu.

| Phase | Nội dung | Verify bằng |
|:---:|---|---|
| **0** | `.vercelignore`, `crawler/package.json` rỗng, `crawler/tsconfig.json` | `vercel build` ở root **vẫn xanh** và bundle không đổi kích thước. Chưa qua bước này thì chưa viết gì thêm. |
| **1a** | Migration `001_status_enum.sql` + sửa 3 file type (§A2, nhóm D2) | `tsc` backend **và** frontend đều EXIT=0; `GET /api/novels` vẫn trả đúng |
| **1b** | Migration `002_crawler_support.sql` + `003_chapter_model.sql` + trigger `bookmarks_count` | `GET /api/novels/:slug` vẫn trả chapters đúng thứ tự; bookmark 1 novel → `bookmarks_count` tăng |
| **1c** | Đổi `ORDER BY` sang `sort_index` + backfill `sort_index` cho chapter đang có | ReaderView prev/next vẫn đúng trên dữ liệu seed |
| **2** | `config/`, `utils/logger.ts`, `database/pool.ts`, `dto/`, `core/contracts/` | script nhỏ in ra `SELECT 1` + config đã load |
| **3** | `repositories/` + `database/transaction.ts` | script tạm upsert **một** novel bịa tay → kiểm tra bằng SQL, rồi xoá |
| **4** | `extractors/` | **unit test thuần, không cần mạng, không cần DB** — phần nhiều edge case nhất, làm sớm |
| **5** | `parsers/` + fixtures HTML | test parser trên fixture đã lưu, vẫn không cần mạng |
| **6** | `normalizers/` (gồm `ContentHasher`, `SlugGenerator`) | fixture → NormalizedNovel, so với snapshot |
| **7** | `crawlers/novelupdates/` + `BaseCrawler` | **lần đầu chạm mạng.** Crawl đúng 1 URL, `--dry-run`, in JSON ra stdout |
| **8** | `importers/` + `CrawlPipeline` | crawl 1 novel thật → ghi DB → `GET /api/novels/:slug` thấy nó |
| **9** | `UpdateDetectionService` + `DeduplicationService` | chạy lại phase 8 lần hai → **0 UPDATE**, chỉ `last_crawled_at` đổi |
| **10** | `CrawlerService` + `jobs/` + `SyncRepository` | `GET /api/timeline` bắt đầu có dữ liệu thật |
| **11** | `cli/` | `npm run crawl:novelupdates -- --limit 10` |
| **12** | `scheduler/` + `.github/workflows/crawl.yml` | workflow_dispatch chạy tay thành công trước, rồi mới bật cron |
| **13** | **Site thứ hai** | bài kiểm tra thật của abstraction: nếu phải sửa file có sẵn thì thiết kế đã sai |

Phase 4–6 cố tình đứng trước phase 7: **phần lớn bug của crawler nằm ở parse và normalize, không
nằm ở network.** Làm xong chúng trước nghĩa là khi bắt đầu gọi mạng thật, ta đã tin được phần
xử lý dữ liệu.

---

## 5. MIGRATION CẦN THIẾT

Sau khi chốt D1–D5, migration tách làm **ba file** — không gộp được, lý do ở §5.0.

### 5.0 ⚠️ Vì sao phải tách ba file

**`ALTER TYPE ... ADD VALUE` không dùng được giá trị mới trong cùng transaction.**
D2 thêm `Dropped` và `Unknown` vào `novel_status`; nếu cùng lúc muốn backfill dữ liệu bằng
`'Unknown'` thì PostgreSQL sẽ báo `unsafe use of new value of enum type`. Nên:

| File | Nội dung | Ghi chú |
|---|---|---|
| `001_status_enum.sql` | chỉ `ALTER TYPE ADD VALUE` | **không** bọc BEGIN/COMMIT |
| `002_crawler_support.sql` | bảng + cột mới | trong transaction, bình thường |
| `003_chapter_model.sql` | đổi mô hình `chapters` theo D1 | trong transaction |

`scripts/run-sql.mjs` chạy nguyên file trong một implicit transaction, nên file 001 phải là file
riêng và không có `BEGIN`.

### 5.1 `001_status_enum.sql` — D2

```sql
ALTER TYPE novel_status ADD VALUE IF NOT EXISTS 'Dropped';
ALTER TYPE novel_status ADD VALUE IF NOT EXISTS 'Unknown';
```

> 🔴 **Việc này PHÁ hợp đồng với frontend.** `types.ts:35` đang khai báo
> `status: 'Ongoing' | 'Completed' | 'Hiatus'`. Bắt buộc phải sửa kèm — chi tiết ở §9.2.

### 5.2 `002_crawler_support.sql`

```sql
-- 1. Nguồn dữ liệu (nền tảng cho "hàng trăm site")
CREATE TABLE sources (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       varchar(60)  NOT NULL UNIQUE,   -- 'novelupdates'
  name       varchar(120) NOT NULL,
  base_url   text         NOT NULL,
  is_enabled boolean      NOT NULL DEFAULT true,
  created_at timestamptz  NOT NULL DEFAULT now()
);

-- 2. Ánh xạ novel <-> nguồn. TRÁI TIM của dedup + update detection.
CREATE TABLE novel_sources (
  novel_id        uuid NOT NULL REFERENCES novels(id)  ON DELETE CASCADE,
  source_id       uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id     varchar(200) NOT NULL,   -- id/slug bên site nguồn
  source_url      text         NOT NULL,   -- <- "NovelUpdates URL"
  content_hash    char(64),                -- sha256 của NormalizedNovel
  last_crawled_at timestamptz,
  last_changed_at timestamptz,
  PRIMARY KEY (source_id, external_id),
  UNIQUE (novel_id, source_id)
);

-- 3. Tên khác
CREATE TABLE novel_alt_titles (
  novel_id uuid NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  title    varchar(300) NOT NULL,
  position smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (novel_id, title)
);

-- 4. Tags (KHÁC genres: NU có ~50 genre nhưng hàng nghìn tag)
CREATE TABLE tags (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(80) NOT NULL UNIQUE,
  name varchar(80) NOT NULL UNIQUE
);
CREATE TABLE novel_tags (
  novel_id uuid NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  tag_id   uuid NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (novel_id, tag_id)
);

-- 5. Cột mới trên novels
ALTER TABLE novels ADD COLUMN language           varchar(40);       -- D3: phase 1 chỉ 'English'
ALTER TABLE novels ADD COLUMN original_publisher varchar(200);

-- 5b. Ranking + đồng bộ (theo đề xuất bổ sung của anh)
--
-- `primary_source_id` là FK, KHÔNG phải chuỗi 'novelupdates': với mục tiêu hàng trăm
-- site, lưu chuỗi sẽ thành enum ngầm không kiểm soát được. novel_sources vẫn là
-- nguồn sự thật quan hệ n-n; cột này chỉ là lối tắt để khỏi JOIN khi hiển thị.
ALTER TABLE novels ADD COLUMN primary_source_id     uuid REFERENCES sources(id);

ALTER TABLE novels ADD COLUMN popularity_score      numeric(10,4) NOT NULL DEFAULT 0;
ALTER TABLE novels ADD COLUMN trending_score        numeric(10,4) NOT NULL DEFAULT 0;

-- HAI mốc thời gian KHÁC NHAU — xem §10.2, đừng gộp:
ALTER TABLE novels ADD COLUMN last_synced_at        timestamptz;  -- lần crawl gần nhất
ALTER TABLE novels ADD COLUMN last_chapter_at       timestamptz;  -- chương mới nhất phát hành

-- Số thô cho update_frequency. `release_frequency` (chuỗi '3 Chapters / Week') giữ
-- nguyên và do presenter layer sinh ra — đúng nguyên tắc Q1 đã chốt.
ALTER TABLE novels ADD COLUMN release_rate_per_week numeric(6,2);

-- Counter cho "Most Followed", duy trì bằng TRIGGER (§10.3) để KHÔNG phải sửa API.
ALTER TABLE novels ADD COLUMN bookmarks_count       integer NOT NULL DEFAULT 0;

-- 6. Gắn nguồn vào log sync đã có
ALTER TABLE sync_runs   ADD COLUMN source_id uuid REFERENCES sources(id);
ALTER TABLE sync_runs   ADD COLUMN mode      varchar(20);
ALTER TABLE sync_events ADD COLUMN source_id uuid REFERENCES sources(id);

INSERT INTO sources (slug, name, base_url)
VALUES ('novelupdates', 'NovelUpdates', 'https://www.novelupdates.com');
```

Index kèm theo:

```sql
CREATE INDEX idx_novel_sources_stale   ON novel_sources (last_crawled_at NULLS FIRST); -- RunPlanner
CREATE INDEX idx_novel_alt_titles_norm ON novel_alt_titles (lower(title));             -- dedup
CREATE INDEX idx_novels_trending       ON novels (trending_score DESC);
CREATE INDEX idx_novels_popularity     ON novels (popularity_score DESC);
CREATE INDEX idx_novels_last_chapter   ON novels (last_chapter_at DESC NULLS LAST);
CREATE INDEX idx_novels_bookmarks      ON novels (bookmarks_count DESC);
CREATE INDEX idx_novels_language       ON novels (language);
```

### 5.3 `003_chapter_model.sql` — D1

```sql
-- 🔴 BẮT BUỘC bỏ: 'Extra Chapter 12' và 'Chapter 12' có cùng number = 12
--    -> ràng buộc này sẽ chặn đúng dữ liệu hợp lệ. Xem §9.1.
ALTER TABLE chapters DROP CONSTRAINT IF EXISTS chapters_novel_number_unique;

-- Định danh chính vẫn là (novel_id, slug) — UNIQUE đó đã có sẵn, vẫn đúng.

ALTER TABLE chapters ADD COLUMN volume_number smallint;
ALTER TABLE chapters ADD COLUMN part_number   smallint;   -- 'c.243.5', 'c.243 part2'
ALTER TABLE chapters ADD COLUMN is_extra      boolean NOT NULL DEFAULT false;
ALTER TABLE chapters ADD COLUMN raw_title     text;       -- verbatim, để re-parse sau
ALTER TABLE chapters ADD COLUMN display_title varchar(300);
ALTER TABLE chapters ADD COLUMN sort_index    numeric(14,4);

-- Thứ tự đọc phải tường minh khi có volume + extra + part (§9.1)
CREATE INDEX idx_chapters_novel_sort ON chapters (novel_id, sort_index);
```

> **Cố ý KHÔNG đổi `number` sang `numeric`.** `pg` trả `numeric` về dưới dạng **string**, sẽ làm
> `ChapterDto.number: number` gãy và buộc phải sửa cả backend lẫn frontend. Tách `part_number`
> riêng cho `c.243.5` giữ được `number integer` nguyên vẹn.

---

## 6. DEPENDENCY GRAPH

```
                         ┌─────────────────────────────┐
                         │   cli/        scheduler/     │   ← entry points
                         └──────────────┬──────────────┘
                                        │
                                   ┌────▼────┐
                                   │  jobs/  │
                                   └────┬────┘
                                        │
                        ┌───────────────▼───────────────┐
                        │          services/            │
                        │  CrawlerService               │
                        │  UpdateDetectionService       │
                        │  DeduplicationService         │
                        └───┬────────────┬──────────┬───┘
                            │            │          │
              ┌─────────────▼──┐   ┌─────▼─────┐  ┌─▼──────────────┐
              │ core/pipeline  │   │ importers/│  │ core/registry  │
              └────┬───────┬───┘   └─────┬─────┘  └────────────────┘
                   │       │             │
        ┌──────────▼─┐  ┌──▼──────────┐  │
        │ crawlers/  │  │ normalizers/│  │
        └──────┬─────┘  └──────┬──────┘  │
               │               │         │
        ┌──────▼─────┐         │   ┌─────▼──────────┐
        │  parsers/  │         │   │ repositories/  │  ← nơi DUY NHẤT có SQL
        └──────┬─────┘         │   └─────┬──────────┘
               │               │         │
        ┌──────▼─────┐         │   ┌─────▼──────┐
        │ extractors/│         │   │ database/  │
        └────────────┘         │   └────────────┘
                               │
       ═══════════════════════════════════════════════════
        dto/  ·  core/contracts/  ·  config/  ·  utils/
        (lá — mọi tầng import được, KHÔNG import ngược lên)
```

### Quy tắc phụ thuộc (không có chu trình)

| Từ | Được import | **Cấm import** |
|---|---|---|
| `extractors/` | utils, dto | mọi thứ khác |
| `parsers/` | extractors, dto, core/contracts, core/errors | crawlers, repositories, database |
| `crawlers/` | parsers, core, config, utils, dto | **repositories, database, importers** |
| `normalizers/` | extractors, dto, utils | crawlers, repositories |
| `repositories/` | database, dto, utils | **crawlers, parsers, services** |
| `importers/` | repositories, dto, core/errors | crawlers, parsers |
| `services/` | tất cả tầng dưới | jobs, cli, scheduler |
| `jobs/` | services, dto, config | cli, scheduler |
| `cli/`, `scheduler/` | jobs, config, utils | — |

**Ràng buộc tuyệt đối:** `crawler/src/**` không được import bất cứ thứ gì từ `../src/**` hoặc
`../api/**`. Đây là định nghĩa của "hoàn toàn cô lập", và nên được chặn bằng lint rule
(`no-restricted-imports`) chứ không chỉ bằng lời hứa.

---

## 7. QUYẾT ĐỊNH ĐÃ CHỐT (2026-08-03)

| # | Quyết định | Hệ quả kỹ thuật |
|---|---|---|
| **D1** | Tạo dòng `chapters` thật, **không hardcode** `"Chapter 243"`. Lưu `raw_chapter_title`, `display_title`, `chapter_number`, `volume_number`, `is_extra` | §9.1 — phải **bỏ** `UNIQUE(novel_id, number)` và thêm `sort_index` |
| **D2** | Enum thành `Ongoing · Completed · Hiatus · Dropped · Unknown` | §9.2 — **phá** `types.ts:35`, phải sửa frontend + zod + migration tách file |
| **D3** | Phase 1: **English only** | filter ở tầng crawler, `language = 'English'` |
| **D4** | Cron **1 tháng/lần**, **1.000–5.000 novel/run**, không crawl toàn site | §9.3 — cảnh báo về độ trễ dữ liệu |
| **D5** | Không hiện `0 Readers`. `recommendations = rating votes`. `total_views` = chỉ số suy ra | §10.1 — có một điểm tôi đề nghị anh cân nhắc lại |
| **D6** | Thêm `popularity_score`, `trending_score`, `last_sync_at`, `update_frequency`, `source` | §5.2 + §10 |

---

## 8bis. §9 — HỆ QUẢ CỦA D1 & D2 LÊN SCHEMA ĐANG CHẠY

### 9.1 D1 phá vỡ `UNIQUE (novel_id, number)` và cả thứ tự đọc

`schema.sql:217` đang có:

```sql
CONSTRAINT chapters_novel_number_unique UNIQUE (novel_id, number)
```

Với `is_extra`, ràng buộc này **chặn đúng dữ liệu hợp lệ**:

| raw_title | number | is_extra | Kết quả |
|---|---|---|---|
| `Chapter 12` | 12 | false | OK |
| `Extra Chapter 12` | 12 | **true** | ❌ **vi phạm UNIQUE** → crawler chết |

→ Bỏ constraint đó. Định danh chương vẫn an toàn nhờ `UNIQUE (novel_id, slug)` đã có sẵn.

**Vấn đề thứ hai, âm thầm hơn:** `ReaderView.tsx:28-31` tính chương trước/sau bằng **index trong
mảng**, và API trả `ORDER BY number ASC`. Khi có volume + extra + part thì `number` không còn là
thứ tự đọc đúng nữa:

```
Vol 5 Chapter 243      -> vol=5  num=243  part=-    extra=false
Chapter 243.5          -> vol=5  num=243  part=5    extra=false
Extra Chapter 12       -> vol=-  num=12   part=-    extra=true
```

Sắp theo `number` sẽ đẩy `Extra Chapter 12` lên trước `Chapter 243` — sai hoàn toàn.

→ **`sort_index numeric(14,4)`**, do `ChapterRefNormalizer` tính và lưu sẵn:

```
sort_index = COALESCE(volume_number, 0) * 1_000_000
           + number * 100
           + COALESCE(part_number, 0)
           + (is_extra ? 0.5 : 0)
```

API đổi `ORDER BY number ASC` → `ORDER BY sort_index ASC NULLS LAST, number ASC`.
**Đây là thay đổi duy nhất trong `src/` mà crawler bắt buộc kéo theo** — một dòng `ORDER BY` ở
`novel.service.ts`, không đụng controller, không đổi shape JSON.

**Ánh xạ 5 field của D1 vào cột:**

| D1 đề xuất | Cột | Ví dụ `"Vol 5 Chapter 243: Return"` |
|---|---|---|
| `raw_chapter_title` | `chapters.raw_title` | `"Vol 5 Chapter 243: Return"` |
| `display_title` | `chapters.display_title` | `"Vol 5 Chapter 243: Return"` |
| `chapter_number` | `chapters.number` *(đã có)* | `243` |
| `volume_number` | `chapters.volume_number` | `5` |
| `is_extra` | `chapters.is_extra` | `false` |
| — | `chapters.title` *(đã có)* | `"Return"` — phần tên riêng, đã bỏ tiền tố |
| — | `chapters.part_number` | `null` |

`chapters.title` giữ nguyên ngữ nghĩa cũ (chỉ tên riêng của chương) vì
`NovelDetailView.tsx:207` và `ReaderView.tsx:108` đang render `Chapter {number}: {title}`.
`display_title` là chuỗi trọn vẹn cho các nơi cần một nhãn duy nhất. Không chương nào bị bịa tên:
NU chỉ cho `"c.243"` thì `title = ''` và `display_title = "Chapter 243"`.

### 9.2 D2 phá hợp đồng type với frontend

`Dropped` và `Unknown` là giá trị enum **mới**, và union ở frontend đang đóng:

| File | Dòng | Phải sửa |
|---|---|---|
| `Lumiere_frontend/src/types.ts` | 35 | thêm `\| 'Dropped' \| 'Unknown'` vào union |
| `Lumiere_backend/src/models/index.ts` | `NovelStatus` | thêm 2 giá trị |
| `Lumiere_backend/src/schemas/novel.schema.ts` | `novelQuerySchema.status` | `z.enum` thêm 2 giá trị |
| `Lumiere_frontend/src/components/DiscoverView.tsx` | 80 | `['All','Ongoing','Completed']` — cân nhắc thêm `Dropped` |

Đây là **thay đổi frontend bắt buộc**, không tránh được — nó là hệ quả trực tiếp của D2. Không
sửa `types.ts` thì `tsc` frontend sẽ fail ngay khi API trả về `"Dropped"`.

DiscoverView bỏ trống cũng không sao: novel `Dropped`/`Unknown` vẫn hiện dưới bộ lọc `All`, chỉ
là không lọc riêng được. Anh muốn thêm vào bộ lọc thì nói.

### 9.3 D4 — cron 1 tháng/lần khiến Timeline luôn cũ ~1 tháng

Đây không phải lỗi, nhưng là hệ quả anh nên biết trước:

- `GET /api/timeline` (màn Library Synchronization Log) sẽ chỉ có sự kiện mỗi tháng một cụm.
- Section **"Recently Updated"** anh muốn thêm sẽ trễ tới 30 ngày.
- Chế độ `latest` — vốn là chế độ **rẻ nhất** (một trang cho biết hàng trăm novel vừa ra chương
  mới) — gần như mất hết giá trị nếu chỉ chạy hàng tháng.

→ **Đề xuất tách lịch**, vẫn nằm gọn trong hạn mức miễn phí của GitHub Actions:

| Workflow | Mode | Cron | Chi phí mỗi lần |
|---|---|---|---|
| `crawl-latest.yml` | `latest` | mỗi 6 giờ | ~1–5 request |
| `crawl-refresh.yml` | `refresh` | **1 tháng/lần** ← đúng D4 | 1.000–5.000 novel |
| `crawl-discover.yml` | `discover` | thủ công (`workflow_dispatch`) | tuỳ |

Nếu anh vẫn muốn đúng một workflow duy nhất chạy hàng tháng thì hoàn toàn được — chỉ cần chấp
nhận độ trễ trên. Kiến trúc không đổi, chỉ là file YAML.

> ⚠️ GitHub **tự tắt scheduled workflow sau 60 ngày repo không có hoạt động**. Với cron hàng
> tháng thì rủi ro này là thật. Nên bật thêm `workflow_dispatch` để chạy tay được.

---

## §10 — RANKING & CÁC SECTION HOME (D5 + D6)

### 10.1 `total_views` — một điểm tôi đề nghị anh cân nhắc lại

Anh chốt `total_views = synthetic metric`. Tôi hiểu vấn đề anh muốn tránh — `"0 Readers"` trông
như web chết. Nhưng cần nói rõ một điều trước khi tôi code:

Chuỗi hiển thị ở [NovelDetailView.tsx:318](../Lumiere_frontend/src/components/NovelDetailView.tsx#L318)
và [HomeView.tsx:232](../Lumiere_frontend/src/components/HomeView.tsx#L232) là **`"2.8M Readers"`**.
Một con số suy ra từ công thức đặt dưới nhãn đó sẽ được người dùng đọc là *"2,8 triệu người đã
đọc truyện này"* — trong khi thực tế Lumiere chưa có người đọc nào. Đó là một thống kê sai
trình bày như thật, không phải một chỉ số nội bộ.

Tin tốt: **chính D6 của anh đã có lời giải đúng.** `popularity_score` và `trending_score` là chỉ
số suy ra, và chúng trung thực vì không tự nhận mình là số lượt đọc.

Ba hướng, tôi đề xuất (a):

| | Cách làm | UI hiển thị | Trung thực? |
|---|---|---|---|
| **(a) đề xuất** | Giữ `total_views = 0`, **đổi nhãn** ô đó sang `ratingsCount` | `"12.4k ratings"` | ✅ số thật từ NU |
| (b) | Ô đó hiện `popularity_score` đã rút gọn | `"Popularity 8.4k"` | ✅ nhãn đúng bản chất |
| (c) | `total_views = f(rating, votes, age)` | `"2.8M Readers"` | ❌ số bịa dưới nhãn thật |

(a) chỉ tốn một dòng sửa ở frontend, và `ratings_count` là dữ liệu **thật** crawl từ NovelUpdates.

Đây là ý kiến của tôi, không phải điều kiện. Anh vẫn chọn (c) thì tôi làm — chỉ cần anh biết
người dùng sẽ hiểu con số đó thế nào.

**`recommendations_count = ratings_count`** thì không vướng gì cả: đây là số phiếu đánh giá thật,
chỉ là đổi chỗ hiển thị. Tôi làm luôn theo D5.

### 10.2 `last_sync_at` vs `last_chapter_at` — hai thứ khác nhau

D6 nêu `last_sync_at`. Cần **hai** cột, vì "Recently Updated" mà dùng nhầm cột sẽ sai hoàn toàn:

| Cột | Ý nghĩa | Dùng cho |
|---|---|---|
| `last_synced_at` | lần cuối **crawler** ghé qua novel này | RunPlanner chọn novel cũ nhất để refresh |
| `last_chapter_at` | lần cuối **có chương mới** phát hành | section **"Recently Updated"** |

Dùng `last_synced_at` cho "Recently Updated" sẽ khiến toàn bộ 5.000 novel cùng "vừa cập nhật"
ngay sau mỗi lần crawl hàng tháng — vô nghĩa với người đọc.

### 10.3 Năm section Home — nguồn dữ liệu

Tất cả đều derive được từ dữ liệu **thật**, không cần bịa:

| Section | Sắp theo | Nguồn |
|---|---|---|
| **Trending** | `trending_score DESC` | popularity × suy giảm theo thời gian + `sync_events` gần đây |
| **Most Followed** | `bookmarks_count DESC` | ⭐ **dữ liệu thật của chính Lumiere** — bảng `bookmarks` |
| **Recently Updated** | `last_chapter_at DESC` | ngày phát hành chương mới nhất |
| **Highest Rated** | `popularity_score DESC` | rating Bayesian (§10.4) |
| **Newly Added** | `created_at DESC` | có sẵn |

**"Most Followed" duy trì bằng TRIGGER, không sửa API.** Bookmark được ghi qua
`POST /api/novels/:slug/bookmark` — mà anh yêu cầu không đụng API. Trigger ở tầng DB giải quyết
trọn vẹn:

```sql
CREATE FUNCTION sync_bookmarks_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE novels SET bookmarks_count = bookmarks_count + 1 WHERE id = NEW.novel_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE novels SET bookmarks_count = GREATEST(bookmarks_count - 1, 0) WHERE id = OLD.novel_id;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bookmarks_count
  AFTER INSERT OR DELETE ON bookmarks
  FOR EACH ROW EXECUTE FUNCTION sync_bookmarks_count();
```

### 10.4 Công thức tính điểm

**`popularity_score` — rating Bayesian, không phải trung bình thô.**
Trung bình thô làm một truyện 5.0★ từ 2 phiếu xếp trên 4.8★ từ 20.000 phiếu:

```
bayes = (v/(v+m)) * R + (m/(v+m)) * C
  R = novels.rating        (thật, từ NU)
  v = novels.ratings_count (thật, từ NU)
  m = 50                   (trọng số prior — chỉnh được trong config)
  C = rating trung bình toàn hệ thống

popularity_score = bayes * ln(1 + v)
```

**`trending_score` — popularity suy giảm theo thời gian + hoạt động gần đây:**

```
trending_score = popularity_score * exp(-age_days / 30)
               + (số chương thêm trong 30 ngày qua từ sync_events) * w
```

Cả hai được tính **theo batch cuối mỗi lần crawl** (`RecomputeScoresJob`), không tính lúc đọc —
để `GET /api/novels?sort=trending` chỉ là một `ORDER BY` trên index.

### 10.5 Phần này cần API mới — nhưng KHÔNG phá cái đang có

Năm section Home cần backend hỗ trợ sắp xếp. Cách **cộng thêm, không phá**:

```
GET /api/novels?sort=trending|followed|updated|rating|new
```

`novelQuerySchema` thêm một field optional; **không truyền `sort` thì hành vi y hệt hôm nay**
(`created_at DESC`) — mọi lời gọi hiện tại của frontend không đổi kết quả.

> Đây là **phạm vi mới ngoài crawler**, và nó chạm vào `src/` mà anh yêu cầu không sửa. Tôi
> **không** tự làm. Đề xuất tách thành công việc riêng sau khi crawler chạy được và DB đã có dữ
> liệu thật — lúc đó mới có gì để xếp hạng.

---

## §11 — 🔴 CHẶN: NovelUpdates từ chối mọi truy cập tự động (đo được 2026-08-03)

### Kết quả đo

Chạy `npm run probe -- https://www.novelupdates.com` — 8 tổ hợp, **tất cả 403**:

| Endpoint | UA tự khai báo bot | UA mặc định |
|---|:---:|:---:|
| `/robots.txt` | 403 | 403 |
| `/feed/` (RSS) | 403 | 403 |
| `/wp-json/` (REST) | 403 | 403 |
| `/` (HTML) | 403 | 403 |

Response header có `server: cloudflare` và `cf-ray` → chặn ở **tầng edge của Cloudflare**,
trước khi request tới được ứng dụng.

### Ba kết luận

**1. Hướng RSS đã chết.** Không phải vì RSS thiếu dữ liệu — mà vì nó bị chặn y hệt HTML. Site
có khai báo `/feed/` và `/series/<slug>/feed/` trong `<link rel="alternate">`, nhưng không đọc
được. *(Ghi chú thêm: feed theo series được đặt tiêu đề "**Comments** Feed", nên kể cả truy cập
được thì nhiều khả năng nó cũng không chứa danh sách chương.)*

**2. Không phải do User-Agent.** `robots.txt` bị 403 ngay cả với UA mặc định của runtime. Vì
vậy đổi UA — kể cả nếu chấp nhận giả trình duyệt — cũng chưa chắc giải quyết được.

**3. Nhiều khả năng là IP reputation hoặc TLS fingerprint.** Trình duyệt trên máy chủ dự án thì
truy cập bình thường (5 fixture được lưu từ đó), nên site không chặn tất cả mọi người.

### Hệ quả nghiêm trọng với thiết kế lịch chạy

**GitHub Actions runner dùng IP datacenter** — đúng loại IP mà Cloudflare hay chặn. Nếu nguyên
nhân là IP thì ba workflow ở §9.3 sẽ không chạy được, **kể cả khi chuyển sang Playwright**:
Playwright sửa được TLS fingerprint và JS challenge, nhưng không đổi được IP.

Đây là rủi ro kiến trúc, không phải lỗi lập trình.

### Việc cần làm để phân định

```bash
cd crawler
npm run probe -- https://www.novelupdates.com
```

Chạy từ **mạng khác** (mạng nhà, 4G):

| Kết quả | Nghĩa là | Hướng xử lý |
|---|---|---|
| Mạng nhà chạy được | Chặn theo IP | GitHub Actions nhiều khả năng hỏng → self-hosted runner, hoặc đổi nguồn |
| Mạng nào cũng 403 | Chặn mọi client không phải trình duyệt | Playwright là hy vọng duy nhất, và cần xin phép nguồn |

### Điều KHÔNG làm

Không dùng residential proxy, không giả mạo TLS fingerprint, không tìm cách vượt challenge của
Cloudflare. 403 trên cả `robots.txt` là tín hiệu rõ ràng rằng site không muốn client tự động truy
cập. Nếu vẫn cần dữ liệu NovelUpdates thì đường đi đúng là **liên hệ xin phép**, không phải kỹ
thuật lách.

### Điểm mạnh của kiến trúc hiện tại

`ISourceAdapter` khiến NovelUpdates chỉ là **một** implementation. Toàn bộ tầng core, extractor,
DTO, database, CLI đều không biết NU tồn tại. Đổi hoặc thêm nguồn khác (RoyalRoad, ScribbleHub —
cả hai đều có API/feed công khai) **không phải sửa gì ở tầng core**, chỉ thêm một thư mục trong
`crawlers/` và `parsers/`.

`npm run probe -- <url>` nên là bước ĐẦU TIÊN cho mọi nguồn mới, trước khi viết một dòng adapter nào.

---

## 8. GHI CHÚ VẬN HÀNH

- **Kết nối DB cho crawler: host POOLER + port 5432 (session mode).**
  Supabase có ba endpoint và chỉ một cái đúng cho crawler:

  | Endpoint | Dùng được? | Lý do |
  |---|---|---|
  | `…pooler.supabase.com:5432` (session) | ✅ | transaction dài OK, có IPv4 |
  | `…pooler.supabase.com:6543` (transaction) | ❌ | ngắt transaction dài của importer |
  | `db.<ref>.supabase.co:5432` (direct) | ❌ | **IPv6-only** → `ENOTFOUND` trên mạng IPv4 |

  Direct connection đã bị chuyển sang IPv6-only, hostname chỉ còn bản ghi AAAA. Nhanh nhất là
  copy `DATABASE_URL` của backend rồi đổi `6543` → `5432`. Username của pooler có dạng
  `postgres.<project-ref>`.
- **Crawlee storage trên GitHub Actions là ephemeral.** Mọi state phải nằm ở Postgres
  (`novel_sources.last_crawled_at`), không được dựa vào `./storage`. Đặt
  `CRAWLEE_PURGE_ON_START=1`.
- **`concurrency: cancel-in-progress` trong workflow** để hai lần cron không chồng lên nhau.
- **Secret riêng cho crawler** (`CRAWLER_DATABASE_URL`), không dùng chung với secret của Vercel —
  để thu hồi độc lập được.
- **Định danh rõ ràng trong User-Agent** kèm URL/email liên hệ, và tôn trọng `robots.txt`. Đây
  vừa là phép lịch sự vừa là tự bảo vệ: IP của GitHub Actions runner là dùng chung, bị chặn thì
  không tự gỡ được.
- **Cảnh báo trôi selector:** nếu tỉ lệ item parse thiếu field vượt ngưỡng (ví dụ >20%), coi như
  site đã đổi HTML → fail run có thông báo rõ, thay vì âm thầm ghi dữ liệu rỗng đè lên dữ liệu tốt.
