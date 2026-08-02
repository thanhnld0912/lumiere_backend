# BACKEND_REQUIREMENTS.md

> **Phase 1 — Phân tích frontend.** Tài liệu này được sinh ra **chỉ từ code thực tế** trong
> `E:\Code\Lumiere_frontend`. Mọi endpoint / bảng / field đều có trích dẫn dòng code làm bằng chứng.
> Chưa có code backend nào được tạo.

---

## 0. TÓM TẮT ĐIỀU HÀNH — ĐỌC TRƯỚC

**Frontend hiện tại KHÔNG gọi API nào cả.** Không có `fetch`, không có `axios`, không có
`XMLHttpRequest`, không có `import.meta.env`, không có biến `VITE_*`, không có base URL.

Bằng chứng (grep toàn bộ `**/*.{ts,tsx,html,json}`):

| Tìm kiếm | Kết quả |
|---|---|
| `fetch(` / `axios` / `XMLHttpRequest` | **0 hit** |
| `import.meta.env` / `VITE_` | **0 hit** |
| `/api/` | **0 hit** |
| `Bearer` / `token` / auth header | **0 hit** |
| `process.env` | 2 hit — chỉ trong `vite.config.ts` (`DISABLE_HMR`), không liên quan backend |
| `localStorage` | 2 hit — `App.tsx:18`, `App.tsx:37` (persist toàn bộ mảng novels) |

Toàn bộ dữ liệu đến từ `src/data/mockData.ts` (hardcode) và được ghi/đọc lại từ
`localStorage['lumiere_novels']`.

**Hệ quả quan trọng:** không thể "lấy danh sách API từ frontend" theo nghĩa đen, vì frontend
chưa gọi API nào. Vì vậy tài liệu này derive API từ hai nguồn **có thật trong code**:

1. **Shape dữ liệu** — `src/types.ts` + `src/data/mockData.ts` (contract chính xác mà UI đang render).
2. **Hành vi UI** — các handler/state trong component (cái gì đọc, cái gì ghi, cái gì là per-user).

Mỗi endpoint dưới đây được đánh nhãn:
- 🟢 **EVIDENCED** — component đang thực sự đọc/ghi dữ liệu này, chỉ là từ mock thay vì HTTP.
- 🟡 **STACK-REQUIRED** — không có caller nào ở frontend, nhưng bắt buộc theo stack anh yêu cầu (JWT/bcrypt).
- 🔴 **KHÔNG TẠO** — có trong ví dụ của anh nhưng frontend không cần → sẽ không implement.

---

## 1. PHÂN TÍCH FRONTEND

### 1.1 Framework & build

| Hạng mục | Giá trị | Nguồn |
|---|---|---|
| Framework | **React 19.2** (`react`, `react-dom`) | `package.json:20-21` |
| Build tool | **Vite 6.2** (KHÔNG phải Next.js) | `package.json:22`, `vite.config.ts` |
| Ngôn ngữ | **TypeScript 5.8** | `package.json`, toàn bộ `.tsx` |
| Styling | **Tailwind CSS v4** qua `@tailwindcss/vite` | `vite.config.ts:8` |
| Icons | Material Symbols Outlined (CDN font) | `index.html:11` |
| Router | **KHÔNG CÓ** — không có `react-router` | `package.json` deps |
| State management | `useState` thuần trong `App.tsx` | `App.tsx:16-32` |
| Dev port | **3000**, host `0.0.0.0` | `package.json:7` → `vite --port=3000` |
| Entry | `index.html` → `src/main.tsx` → `src/App.tsx` | `main.tsx:6-10` |

**Lưu ý strict mode:** `tsconfig.json` của frontend **KHÔNG bật `strict`**. Backend sẽ bật
`strict: true` như anh yêu cầu — hai project độc lập nên không xung đột.

**Lưu ý deps thừa:** `package.json` khai báo `express`, `@google/genai`, `dotenv` nhưng
**không file nào import chúng** (grep 0 hit trong `src/`). Đây là leftover từ template AI Studio.
Không ảnh hưởng backend.

### 1.2 Cấu trúc thư mục (14 files)

```
E:\Code\Lumiere_frontend
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── metadata.json           # AI Studio metadata, không liên quan
├── .env.example            # CHỈ có GEMINI_API_KEY + APP_URL — không có API URL
└── src
    ├── main.tsx            # bootstrap React
    ├── App.tsx             # ⭐ toàn bộ state + navigation (tab-based)
    ├── index.css
    ├── types.ts            # ⭐ contract dữ liệu
    ├── data/mockData.ts    # ⭐ mock 10 novels + 3 timeline items + sync stats
    └── components
        ├── Header.tsx          # nav desktop
        ├── BottomNav.tsx       # nav mobile
        ├── SearchModal.tsx     # search overlay
        ├── HomeView.tsx        # hero + continue reading + trending
        ├── DiscoverView.tsx    # filter genre/status/search
        ├── NovelDetailView.tsx # detail + chapter list + translation group
        ├── ReaderView.tsx      # đọc chương + reader settings
        ├── TimelineView.tsx    # sync log + stats
        └── ProfileView.tsx     # profile + bookmarks + history
```

### 1.3 "Routes" — thực chất là tab state, không phải URL

Không có router. `App.tsx:26` giữ `currentTab: string`. Các giá trị hợp lệ (từ
`Header.tsx`, `BottomNav.tsx`, `App.tsx`):

| Tab | Component render | Nguồn |
|---|---|---|
| `home` | `HomeView` | `App.tsx:123` |
| `discover` | `DiscoverView` | `App.tsx:160` |
| `library` | `ProfileView` | `App.tsx:164` |
| `profile` | `ProfileView` (giống hệt `library`) | `App.tsx:172` |
| `timeline` | `TimelineView` | `App.tsx:151` |
| `detail` | `NovelDetailView` | `App.tsx:132` |
| `reader` | `ReaderView` | `App.tsx:142` |

> ⚠️ `library` và `profile` render **cùng một component với cùng props** — hiện là trùng lặp.
> Backend không cần phân biệt.

### 1.4 Authentication flow hiện tại

**KHÔNG TỒN TẠI.** Không có login form, không có register form, không có logout,
không có token, không có protected view. Danh tính user bị **hardcode trong JSX**:

```tsx
// ProfileView.tsx:31-46
<h2>Archivist Traveler</h2>
<p>nguyenledangthanh.a41922@gmail.com • VIP Reader Level 8</p>
<span>2,400 Chapters Read</span>
<span>{bookmarkedNovels.length} Bookmarks</span>   // ← cái duy nhất là dynamic
<span>42 Days Streak</span>
```

Avatar là một URL hằng số: `USER_AVATAR` (`mockData.ts:299`), dùng ở `Header.tsx:97` và
`ProfileView.tsx:26`.

Tuy nhiên **dữ liệu per-user thì có thật** và đang được lưu trong localStorage:
`isBookmarked`, `lastReadChapterId`, `lastReadProgress`, `chapter.isRead`,
`translationGroup.isFollowed`. Đây chính là lý do auth là cần thiết (xem §4).

### 1.5 Dữ liệu HARDCODE trong JSX (KHÔNG sinh API cho những cái này)

Để tránh "tự đoán", đây là các con số hiện đang là **string literal trong JSX**, không đến từ
`types.ts` hay `mockData.ts`. Chúng **không** được coi là yêu cầu backend:

| Giá trị | Vị trí |
|---|---|
| `"Discover Your Next Favorite"` + dòng mô tả hero | `HomeView.tsx:43-47` |
| `"32 New Novels Added"`, `75%`, `"Next sync in 12 days"` | `HomeView.tsx:132,161,164` |
| `1,248 Total Volumes` / `452 Active Readers` / `99.9% Uptime` | `HomeView.tsx:174-188` |
| 5 sao cứng (không theo `novel.rating`) ở Trending | `HomeView.tsx:226-230` |
| `"Volume 1: The Beginning"` | `NovelDetailView.tsx:191` |
| Progress bar reader `45%` / `"12 mins left in chapter"` | `ReaderView.tsx:161-166` |
| Node July/June 2024 + `"34 Series Updated · 162 Chapters Sync'd"` | `TimelineView.tsx:159-186` |
| `"Checking 1,240 data nodes across 14 providers"` | `TimelineView.tsx:210` |
| `"2,400 Chapters Read"`, `"42 Days Streak"`, `"VIP Reader Level 8"` | `ProfileView.tsx:40,45,34` |
| Danh sách genre filter (8 mục) | `DiscoverView.tsx:14` |
| Popular tags trong search | `SearchModal.tsx:59` |

---

## 2. PHÁT HIỆN QUAN TRỌNG — ẢNH HƯỞNG TRỰC TIẾP ĐẾN THIẾT KẾ API

Đây là phần quan trọng nhất của Phase 1. Bốn phát hiện dưới đây quyết định schema.

### 🔴 F1 — Frontend hardcode `id` dạng **slug**, không phải UUID

```tsx
App.tsx:29        INITIAL_NOVELS.find((n) => n.id === 'shadow-of-the-void')
App.tsx:31        useState<string|undefined>('ch-01')
HomeView.tsx:18   novels.find((n) => n.id === 'eternal-archive')
HomeView.tsx:50   onReadChapter(heroNovel, 'ch-42')
```

**Hệ quả:** vì "không được sửa frontend", field `id` trong JSON response **bắt buộc** phải là
slug (`"eternal-archive"`, `"ch-42"`), không được là UUID.

→ **Giải pháp:** DB dùng `uuid` làm PK nội bộ, thêm cột `slug` UNIQUE. Layer serialize map
`slug → id` khi trả JSON. Sạch ở DB, khớp 100% ở API.

### 🔴 F2 — `chapter.id` KHÔNG unique toàn cục

`ch-42` xuất hiện ở **cả hai** novel:
- `mockData.ts:42` — trong `shadow-of-the-void`
- `mockData.ts:71` — trong `eternal-archive`

Tương tự `ch-01`, `ch-02`.

**Hệ quả:** không tồn tại route `GET /api/chapters/:id`. Mọi truy cập chương **phải** nested
dưới novel: `GET /api/novels/:novelSlug/chapters/:chapterSlug`. DB cần
`UNIQUE (novel_id, slug)` chứ không phải `UNIQUE (slug)`.

### 🟠 F3 — Nhiều field là **string đã format sẵn cho UI**, không phải số

| Field | Kiểu TS | Giá trị mock | Render tại |
|---|---|---|---|
| `ratingsCount` | `string` | `'12.4k'` | `NovelDetailView.tsx:86` |
| `totalViews` | `string` | `'2.8M Readers'` | `HomeView.tsx:232`, `NovelDetailView.tsx:318` |
| `recommendationsCount` | `string` | `'+8k'` | `NovelDetailView.tsx:336` |
| `chapter.date` | `string` | `'Oct 12, 2023'` | `NovelDetailView.tsx:212` |
| `TimelineItem.timeAgo` | `string` | `'2h ago'` | `TimelineView.tsx:147` |
| `TimelineItem.month` / `year` | `string` | `'August'` / `'2024'` | `types.ts:52-53` |
| `SyncStats.totalChapters` | `string` | `'2.4k'` | `TimelineView.tsx:52` |
| `SyncStats.chaptersThisMonth` | `string` | `'+142 discovered this month'` | `TimelineView.tsx:55` |
| `SyncStats.nextSyncCountdown` | `string` | `'4m 12s'` | `TimelineView.tsx:222` |
| `translationGroup.quality` | `string` | `'Primary Translation Group • High Quality'` | `NovelDetailView.tsx:269` |

> Chú ý mâu thuẫn nội bộ: `Novel.totalChapters` là **number** (`types.ts:30`) nhưng
> `SyncStats.totalChapters` là **string** (`types.ts:57`).

**Xung đột cần anh quyết (xem §8, câu hỏi Q1):** ràng buộc "không sửa frontend" nói API phải
trả string đã format. Nhưng nguyên tắc kiến trúc sạch nói DB/API nên trả số thô.

→ **Đề xuất của tôi:** DB lưu **số thô** (`ratings_count INTEGER`, `total_views BIGINT`,
`published_at TIMESTAMPTZ`…), và có một **presenter layer** ở backend format ra đúng string mà UI
đang mong đợi. Cách này thoả cả hai ràng buộc mà không đụng một dòng frontend nào, và khi anh
muốn chuyển sang raw sau này thì chỉ cần bỏ presenter.

### 🟠 F4 — State per-user đang bị **nhúng thẳng vào object Novel**

`Novel` trộn dữ liệu chung và dữ liệu riêng của user:

| Field per-user | Ghi tại |
|---|---|
| `isBookmarked` | `App.tsx:85-92` (`handleToggleBookmark`) |
| `lastReadChapterId` | `App.tsx:72` |
| `lastReadProgress` | đọc ở `HomeView.tsx:85`; **không có code nào ghi** |
| `chapters[].isRead` | `App.tsx:67-69` |
| `translationGroup.isFollowed` | `NovelDetailView.tsx:22` (chỉ local state, không persist) |

**Hệ quả:** `GET /api/novels` và `GET /api/novels/:id` phải **merge** state của user hiện tại vào
payload. Endpoint là public (gọi được khi chưa login) nhưng nếu có JWT hợp lệ thì trả thêm các
field trên → dùng middleware `optionalAuth`.

### 🟡 F5 — Các phát hiện nhỏ khác

- **Timeline trỏ tới novel không tồn tại:** `MOCK_TIMELINE_ITEMS` có `novelId` là
  `'neon-chronicles'`, `'emerald-whispers'`, `'gear-and-ghost'` (`mockData.ts:257,268,279`) —
  không novel nào có id đó. `TimelineView.tsx:119` fallback `|| novels[0]`. Ở DB thật đây sẽ là
  FK hợp lệ, nên vấn đề tự biến mất.
- **Field khai báo nhưng chưa render:** `Novel.artist` (`types.ts:24`), `Chapter.wordCount`
  (`types.ts:9`). Vẫn giữ trong schema vì có trong contract, nhưng đánh dấu optional.
- **`Novel.chapters` trong list view là mảng rút gọn:** mock chỉ có 1–7 chapter dù
  `totalChapters` là 243/120/… → API list **không** trả full chapter list.
- **`ReaderSettings` (`types.ts:68-73`) hoàn toàn in-memory,** reset khi rời ReaderView
  (`ReaderView.tsx:35-40`). Không có persistence → **không tạo endpoint** (xem Q3).
- **`novel.chapters` được dùng để tính prev/next chapter** (`ReaderView.tsx:28-31`) → detail
  endpoint phải trả chapters theo thứ tự `number` tăng dần.

---

## 3. API SPECIFICATION

**Base URL:** `/api` — Content-Type `application/json`.

**Response envelope thống nhất:**

```jsonc
// Thành công
{ "success": true, "data": <payload> }

// Lỗi (đúng format anh yêu cầu)
{ "success": false, "message": "...", "errors": [] }
```

### 3.0 Bảng tổng hợp

| # | Method | Endpoint | Auth | Nhãn | Component tiêu thụ |
|---|---|---|---|---|---|
| 1 | POST | `/api/auth/register` | — | 🟡 | *(chưa có UI)* |
| 2 | POST | `/api/auth/login` | — | 🟡 | *(chưa có UI)* |
| 3 | GET | `/api/auth/me` | ✅ | 🟢 | `ProfileView`, `Header` (avatar) |
| 4 | GET | `/api/novels` | optional | 🟢 | `HomeView`, `DiscoverView`, `SearchModal` |
| 5 | GET | `/api/novels/:slug` | optional | 🟢 | `NovelDetailView` |
| 6 | GET | `/api/novels/:slug/chapters/:chapterSlug` | optional | 🟢 | `ReaderView` |
| 7 | POST | `/api/novels/:slug/bookmark` | ✅ | 🟢 | `NovelDetailView` (nút bookmark) |
| 8 | DELETE | `/api/novels/:slug/bookmark` | ✅ | 🟢 | `NovelDetailView` (nút bookmark) |
| 9 | PUT | `/api/novels/:slug/chapters/:chapterSlug/progress` | ✅ | 🟢 | `App.handleReadChapter` |
| 10 | GET | `/api/library/bookmarks` | ✅ | 🟢 | `ProfileView` tab Bookmarks |
| 11 | GET | `/api/library/history` | ✅ | 🟢 | `ProfileView` tab History, `HomeView` Continue Reading |
| 12 | GET | `/api/timeline` | optional | 🟢 | `TimelineView` |
| 13 | GET | `/api/timeline/stats` | optional | 🟢 | `TimelineView` bento cards |
| 14 | POST | `/api/translation-groups/:slug/follow` | ✅ | 🟢 | `NovelDetailView` nút Follow |
| 15 | DELETE | `/api/translation-groups/:slug/follow` | ✅ | 🟢 | `NovelDetailView` nút Follow |

**Tổng: 15 endpoints.** Không hơn.

---

### 3.1 Authentication

#### `POST /api/auth/register` 🟡

```jsonc
// Request
{ "email": "reader@lumiere.app", "password": "SecurePass123", "displayName": "Archivist Traveler" }
```
`registerSchema` (zod): `email` — email hợp lệ, ≤255; `password` — 8..72 ký tự
(72 = giới hạn bcrypt); `displayName` — 2..80.

```jsonc
// 201
{ "success": true,
  "data": {
    "token": "eyJhbGciOi...",
    "user": { "id": "…uuid…", "email": "reader@lumiere.app",
              "displayName": "Archivist Traveler", "avatarUrl": null, "role": "user" } } }
```
Lỗi: `409` email đã tồn tại · `422` validation.

#### `POST /api/auth/login` 🟡

```jsonc
// Request
{ "email": "reader@lumiere.app", "password": "SecurePass123" }
```
```jsonc
// 200 — cùng shape với register
{ "success": true, "data": { "token": "…", "user": { … } } }
```
Lỗi: `401` `"Invalid email or password"` (message giống nhau cho cả email sai và password sai —
tránh user enumeration).

#### `GET /api/auth/me` 🟢 — *bắt buộc, `ProfileView` đang render thông tin này*

```jsonc
// 200
{ "success": true,
  "data": {
    "id": "…uuid…",
    "email": "nguyenledangthanh.a41922@gmail.com",   // ProfileView.tsx:34
    "displayName": "Archivist Traveler",             // ProfileView.tsx:31
    "avatarUrl": "https://…",                        // Header.tsx:97, ProfileView.tsx:26
    "role": "user",
    "stats": {
      "chaptersRead": 2400,      // ProfileView.tsx:40 — hiện hardcode "2,400"
      "bookmarksCount": 5,       // ProfileView.tsx:42 — hiện tính client-side
      "streakDays": 42           // ProfileView.tsx:45 — hiện hardcode "42"
    } } }
```
> `stats` là dữ liệu duy nhất trong ProfileView chưa có nguồn. Đưa vào đây vì nó thuộc về user,
> `bookmarksCount` đã derive được từ DB; `chaptersRead` derive từ `chapter_reads`;
> `streakDays` derive từ `chapter_reads.read_at`. Không có field nào bịa.

---

### 3.2 Novels

#### `GET /api/novels` 🟢

Tiêu thụ bởi: `App.tsx:16` (nguồn `novels` cho toàn app) → `HomeView` (hero/continue/trending),
`DiscoverView`, `SearchModal`.

Query params (đều **optional** — hiện frontend lọc client-side, nhưng cần cho scale):

| Param | Kiểu | Ghi chú | Bằng chứng UI |
|---|---|---|---|
| `q` | string | khớp title / author / genre | `DiscoverView.tsx:19-22`, `SearchModal.tsx:22-27` |
| `genre` | string | genre name | `DiscoverView.tsx:17` |
| `status` | `Ongoing\|Completed\|Hiatus` | | `DiscoverView.tsx:18`, `types.ts:29` |
| `limit` / `offset` | int | phân trang | *(chuẩn bị trước)* |

```jsonc
// 200 — mảng NovelSummary, KHÔNG kèm synopsis dài / chapters đầy đủ
{ "success": true,
  "data": {
    "items": [
      { "id": "eternal-archive",                       // ← slug (F1)
        "title": "The Eternal Archive: Chronicles of the Void-Born",
        "author": "Elara Vance",
        "artist": null,
        "coverUrl": "https://…",
        "backdropUrl": null,
        "rating": 4.95,
        "ratingsCount": "28.1k",                       // string đã format (F3)
        "status": "Ongoing",
        "totalChapters": 120,                          // number
        "genres": ["Fantasy", "Mystery", "Magic"],
        "synopsis": "Deep within the Ivory Tower…",
        "releaseFrequency": "5 Chapters / Week",
        "totalViews": "4.1M Readers",
        "recommendationsCount": "+12k",
        "recommendationsAvatars": [],
        "translationGroup": {
          "name": "Sky Novels",
          "quality": "Official Scanlation",
          "avatarUrl": "https://…",
          "siteUrl": "https://skynovels.example.com",
          "isFollowed": false                          // chỉ khi có JWT
        },
        "chapters": [                                  // rút gọn — xem F5
          { "id": "ch-42", "number": 42, "title": "The Awakening",
            "date": "Jul 28, 2024", "isRead": false }
        ],
        "lastReadChapterId": "ch-42",                  // chỉ khi có JWT (F4)
        "lastReadProgress": 45,                        // chỉ khi có JWT
        "isBookmarked": true                           // chỉ khi có JWT
      }
    ],
    "total": 10 } }
```

> ⚠️ **Quyết định cần anh xác nhận (Q2):** `App.tsx` đang giữ một mảng `Novel[]` duy nhất và
> `HomeView.tsx:24` lấy `novels.slice(4, 9)` làm "Trending". Nghĩa là **thứ tự trả về có ý nghĩa
> hiển thị**. Tôi đề xuất sort mặc định `created_at DESC` và giữ nguyên hành vi slice của frontend.

#### `GET /api/novels/:slug` 🟢

Tiêu thụ bởi `NovelDetailView`. Khác `GET /api/novels` ở chỗ: trả **đầy đủ `chapters`**
(sort theo `number ASC` — bắt buộc, vì `ReaderView.tsx:28-31` tính prev/next theo index mảng).

```jsonc
// 200 — cùng shape một phần tử của /api/novels, nhưng chapters đầy đủ
{ "success": true, "data": { …Novel…, "chapters": [ /* tất cả, number ASC, KHÔNG kèm content */ ] } }
```
Lỗi: `404` `"Novel not found"`.

#### `GET /api/novels/:slug/chapters/:chapterSlug` 🟢

Tiêu thụ bởi `ReaderView` — đây là endpoint duy nhất trả `content`.

```jsonc
// 200
{ "success": true,
  "data": {
    "id": "ch-42",
    "number": 42,
    "title": "The Awakening",
    "date": "Jul 28, 2024",
    "isRead": false,                    // chỉ khi có JWT
    "wordCount": 412,                   // types.ts:9 — optional
    "illustrationUrl": "https://…",     // ReaderView.tsx:114-125 — nullable
    "content": [                        // string[] — ReaderView.tsx:56, mỗi phần tử = 1 <p>
      "The dawn did not break with a roar…",
      "The manuscript lay open before her…"
    ] } }
```
Lỗi: `404` novel hoặc chapter không tồn tại.

---

### 3.3 Library / user state

#### `POST` & `DELETE /api/novels/:slug/bookmark` 🟢 — 🔒

Nguồn: `App.tsx:85-92` `handleToggleBookmark` (hiện chỉ đảo state local).
Dùng POST/DELETE riêng thay vì một endpoint "toggle" để idempotent.

```jsonc
// 200 (cả POST lẫn DELETE)
{ "success": true, "data": { "novelId": "shadow-of-the-void", "isBookmarked": true } }
```

#### `PUT /api/novels/:slug/chapters/:chapterSlug/progress` 🟢 — 🔒

Nguồn: `App.tsx:57-83` `handleReadChapter` — làm **3 việc cùng lúc**, nên endpoint này cũng vậy:
1. `chapters[i].isRead = true` (`App.tsx:67-69`)
2. `novel.lastReadChapterId = targetChapterId` (`App.tsx:72`)
3. `novel.lastReadProgress` — field được **đọc** ở `HomeView.tsx:85` nhưng **không code nào ghi**
   → API nhận `progress` optional, mặc định giữ nguyên giá trị cũ.

```jsonc
// Request
{ "progress": 45 }          // optional, int 0..100
```
```jsonc
// 200
{ "success": true,
  "data": { "novelId": "eternal-archive", "lastReadChapterId": "ch-42",
            "lastReadProgress": 45, "isRead": true } }
```

#### `GET /api/library/bookmarks` 🟢 — 🔒

Nguồn: `ProfileView.tsx:18` `novels.filter(n => n.isBookmarked)`.
Trả mảng NovelSummary (có `lastReadChapterId` để render dòng "Chapter N: Title",
`ProfileView.tsx:78,102`).

#### `GET /api/library/history` 🟢 — 🔒

Nguồn: `ProfileView.tsx:19` và `HomeView.tsx:21` — cả hai đều là
`novels.filter(n => n.lastReadChapterId)`.
Trả mảng NovelSummary + `lastReadChapterId` + `lastReadProgress`, sort `updated_at DESC`.

---

### 3.4 Timeline

#### `GET /api/timeline` 🟢

Nguồn: `TimelineView.tsx:118-153`, type `TimelineItem` (`types.ts:44-54`).

```jsonc
// 200
{ "success": true,
  "data": {
    "items": [
      { "id": "tl-1",
        "novelId": "neon-chronicles",                    // slug, FK thật
        "novelTitle": "Neon Chronicles",
        "novelCover": "https://…",
        "translator": "Translation by Abyss Scans",      // string đã format (F3)
        "chaptersAddedCount": 5,                         // number
        "timeAgo": "2h ago",                             // string đã format (F3)
        "month": "August",
        "year": "2024" }
    ] } }
```

#### `GET /api/timeline/stats` 🟢

Nguồn: `SyncStats` (`types.ts:56-63`), render tại `TimelineView.tsx:52-92,210-232`.

```jsonc
// 200
{ "success": true,
  "data": {
    "totalChapters": "2.4k",                              // string (F3)
    "chaptersThisMonth": "+142 discovered this month",    // string (F3)
    "newSeriesCount": 12,                                 // number
    "newGroupsCount": 3,                                  // number
    "nextSyncCountdown": "4m 12s",                        // string (F3)
    "nextSyncPercentage": 74 } }                          // number 0..100
```

---

### 3.5 Translation groups

#### `POST` & `DELETE /api/translation-groups/:slug/follow` 🟢 — 🔒

Nguồn: `NovelDetailView.tsx:22,283-293` — nút Follow/Following. Hiện chỉ là `useState` local,
mất khi rời trang. `TranslationGroup.isFollowed` có trong `types.ts:17` và mock
(`mockData.ts:22`) → đây là state có chủ đích được persist.

```jsonc
// 200
{ "success": true, "data": { "groupSlug": "aetheric-scans", "isFollowed": true } }
```

---

### 3.6 🔴 KHÔNG TẠO — có trong ví dụ của anh nhưng frontend KHÔNG cần

| Đề xuất ban đầu | Lý do loại bỏ |
|---|---|
| `Comment` + API comment | **0 hit** — không component nào render/gửi comment |
| `Rating` submit (`POST /ratings`) | Rating chỉ **hiển thị** (`novel.rating`). Không có UI chấm điểm ở bất kỳ đâu |
| `Category` API | Genre list hardcode ở `DiscoverView.tsx:14`, không fetch |
| `Book` (tách khỏi `Novel`) | Không tồn tại khái niệm "Book" trong frontend |
| `GET /api/users/profile` | Trùng `GET /api/auth/me` — chọn `/auth/me` |
| `PATCH /api/users/profile` | Không có form sửa profile |
| Refresh token / logout endpoint | Anh chỉ yêu cầu access token; không có UI logout |
| `POST /api/novels/:id/recommend` | `recommendationsAvatars`/`Count` chỉ hiển thị, không có nút recommend |
| Upload avatar / cover | Không có `<input type="file">` nào |
| Reader settings persistence | `ReaderSettings` in-memory, reset mỗi lần vào (Q3) |

---

## 4. AUTHENTICATION FLOW

### 4.1 Luồng

```
┌──────────┐  POST /api/auth/register {email,password,displayName}
│ Frontend │ ────────────────────────────────────────────────────►┐
└──────────┘                                                      │
      ▲                                            zod validate ──┤
      │                                    bcryptjs.hash(pw, 12) ─┤
      │                                       INSERT INTO users ──┤
      │  201 { token, user }                jwt.sign(payload) ────┤
      └──────────────────────────────────────────────────────────◄┘

┌──────────┐  POST /api/auth/login {email,password}
│ Frontend │ ────────────────────────────────────────────────────►┐
└──────────┘                              SELECT … WHERE email ───┤
      ▲                                bcryptjs.compare(pw,hash) ─┤
      │  200 { token, user }                jwt.sign(payload) ────┤
      └──────────────────────────────────────────────────────────◄┘

┌──────────┐  Authorization: Bearer <token>
│ Frontend │ ────────────────────────────────────────────────────►┐
└──────────┘                          auth.middleware verify ─────┤
                                        req.user = payload ───────┤
                                          controller ─────────────┘
```

### 4.2 JWT payload — đúng spec anh yêu cầu

```jsonc
{ "userId": "uuid", "email": "reader@lumiere.app", "role": "user",
  "iat": 1770000000, "exp": 1770604800 }
```
- Secret: `process.env.JWT_SECRET` (bắt buộc, app fail-fast khi thiếu)
- Thuật toán: `HS256` · TTL: `7d` (đề xuất — Q4)

### 4.3 Ba tầng middleware

| Middleware | Hành vi | Dùng cho |
|---|---|---|
| `requireAuth` | Không có/sai token → `401`. Set `req.user` | #3, #7–#11, #14, #15 |
| `optionalAuth` | Có token hợp lệ → set `req.user`. Không có → đi tiếp, `req.user = undefined`. **Token sai → vẫn 401** (không nuốt lỗi) | #4, #5, #6, #12, #13 |
| `requireRole('admin')` | Kiểm tra `req.user.role` | *(chưa dùng — chuẩn bị cho crawler admin sau này)* |

`optionalAuth` là mấu chốt để giải quyết **F4**: novel list/detail xem được khi chưa login,
nhưng có login thì kèm `isBookmarked` / `lastReadChapterId` / `isRead`.

### 4.4 CORS

Dev frontend chạy ở **port 3000** (`package.json:7` → `vite --port=3000 --host=0.0.0.0`).

```ts
cors({
  origin: process.env.FRONTEND_URL?.split(',') ?? ['http://localhost:3000'],
  credentials: false,              // dùng Bearer token, không dùng cookie
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
})
```
`credentials: false` vì auth qua header `Authorization`, không qua cookie → tránh
`Access-Control-Allow-Credentials` + wildcard origin xung đột.

---

## 5. DATABASE SCHEMA PROPOSAL

### 5.1 Danh sách bảng (13 bảng)

| # | Bảng | Mục đích | Bắt nguồn từ |
|---|---|---|---|
| 1 | `users` | tài khoản | `ProfileView`, JWT |
| 2 | `translation_groups` | nhóm dịch | `types.ts:12-18` |
| 3 | `novels` | truyện | `types.ts:20-42` |
| 4 | `genres` | thể loại | `Novel.genres` |
| 5 | `novel_genres` | N-N novel ↔ genre | `Novel.genres: string[]` |
| 6 | `chapters` | metadata chương | `types.ts:1-10` |
| 7 | `chapter_contents` | nội dung chương (tách riêng) | `Chapter.content?: string[]` |
| 8 | `bookmarks` | 🔒 per-user | `Novel.isBookmarked` |
| 9 | `reading_progress` | 🔒 per-user, 1 dòng / (user,novel) | `lastReadChapterId`, `lastReadProgress` |
| 10 | `chapter_reads` | 🔒 per-user, 1 dòng / (user,chapter) | `Chapter.isRead` |
| 11 | `group_follows` | 🔒 per-user | `TranslationGroup.isFollowed` |
| 12 | `novel_recommendations` | avatars + count | `recommendationsAvatars`, `recommendationsCount` |
| 13 | `sync_events` | log crawl | `TimelineItem` |
| 14 | `sync_runs` | trạng thái lần sync kế tiếp | `SyncStats.nextSync*` |

> Thực tế 14 bảng — `sync_runs` tách khỏi `sync_events` vì `SyncStats` có 2 nhóm dữ liệu khác
> bản chất: thống kê tích luỹ (từ `sync_events`) và trạng thái run hiện tại (`sync_runs`).

### 5.2 ERD

```
                      ┌────────────────────┐
                      │ translation_groups │
                      └─────────┬──────────┘
                                │ 1
                                │
                                │ N
┌──────────┐  N   ┌─────────────▼──────┐  1   N ┌──────────┐  1  1 ┌──────────────────┐
│  genres  ├──────┤       novels       ├────────┤ chapters ├───────┤ chapter_contents │
└──────────┘ via  └──────┬──────┬──────┘        └────┬─────┘       └──────────────────┘
        novel_genres     │      │                    │
                         │      │                    │
   ┌─────────────────────┘      └──────────┐         │
   │ N                                   N │         │ N
┌──▼──────────┐  ┌──────────────────┐  ┌────▼────────┐ ┌──▼───────────┐
│  bookmarks  │  │ reading_progress │  │ sync_events │ │ chapter_reads│
└──┬──────────┘  └────────┬─────────┘  └─────────────┘ └───┬──────────┘
   │ N                  N │                                │ N
   └──────────┬───────────┴────────────────────────────────┘
              │ 1
        ┌─────▼─────┐   N   ┌───────────────┐
        │   users   ├───────┤ group_follows │
        └─────┬─────┘       └───────────────┘
              │ N
    ┌─────────▼─────────────┐        ┌───────────┐
    │ novel_recommendations │        │ sync_runs │  (standalone)
    └───────────────────────┘        └───────────┘
```

### 5.3 Chi tiết bảng

**`users`**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | `uuid` | PK, `DEFAULT gen_random_uuid()` |
| `email` | `citext` | NOT NULL, UNIQUE |
| `password_hash` | `text` | NOT NULL |
| `display_name` | `varchar(80)` | NOT NULL |
| `avatar_url` | `text` | NULL |
| `role` | `user_role` (enum: `user`,`admin`) | NOT NULL DEFAULT `'user'` |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL DEFAULT `now()` |

> `citext` cần `CREATE EXTENSION citext` — Supabase có sẵn. Nếu anh muốn tránh extension:
> dùng `text` + `UNIQUE (lower(email))`.

**`translation_groups`**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | `uuid` | PK |
| `slug` | `varchar(120)` | NOT NULL, UNIQUE |
| `name` | `varchar(160)` | NOT NULL |
| `quality` | `varchar(200)` | NULL — string mô tả (F3) |
| `avatar_url` / `site_url` | `text` | NULL |
| `created_at` | `timestamptz` | DEFAULT `now()` |

**`novels`**

| Cột | Kiểu | Ràng buộc / ghi chú |
|---|---|---|
| `id` | `uuid` | PK |
| `slug` | `varchar(160)` | NOT NULL, UNIQUE ← **API trả cột này làm `id`** (F1) |
| `title` | `varchar(300)` | NOT NULL |
| `author` | `varchar(160)` | NOT NULL |
| `artist` | `varchar(160)` | NULL (F5) |
| `cover_url` | `text` | NOT NULL |
| `backdrop_url` | `text` | NULL |
| `rating` | `numeric(3,2)` | `CHECK (rating >= 0 AND rating <= 5)` |
| `ratings_count` | `integer` | NOT NULL DEFAULT 0, `CHECK >= 0` — **số thô**, format ở presenter |
| `status` | `novel_status` (enum `Ongoing`,`Completed`,`Hiatus`) | NOT NULL — khớp `types.ts:29` |
| `total_chapters` | `integer` | NOT NULL DEFAULT 0, `CHECK >= 0` |
| `synopsis` | `text` | NOT NULL |
| `translation_group_id` | `uuid` | FK → `translation_groups(id)` `ON DELETE SET NULL`, NULL |
| `release_frequency` | `varchar(80)` | NULL |
| `total_views` | `bigint` | NOT NULL DEFAULT 0 — **số thô** |
| `created_at` / `updated_at` | `timestamptz` | DEFAULT `now()` |

Index: `idx_novels_status`, `idx_novels_created_at DESC`,
GIN trigram trên `title`/`author` cho `q` search.

**`genres`** — `id uuid PK`, `slug varchar(60) UNIQUE`, `name varchar(60) NOT NULL UNIQUE`.

**`novel_genres`** — `novel_id uuid FK ON DELETE CASCADE`, `genre_id uuid FK ON DELETE CASCADE`,
`position smallint NOT NULL DEFAULT 0`, PK `(novel_id, genre_id)`.
> `position` cần thiết vì `HomeView.tsx:219` render `novel.genres[0]` → **thứ tự genre có ý nghĩa**.

**`chapters`**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | `uuid` | PK |
| `novel_id` | `uuid` | NOT NULL, FK → `novels(id)` `ON DELETE CASCADE` |
| `slug` | `varchar(60)` | NOT NULL ← trả làm `id` (F1) |
| `number` | `integer` | NOT NULL, `CHECK > 0` |
| `title` | `varchar(300)` | NOT NULL |
| `published_at` | `timestamptz` | NOT NULL — presenter format thành `"Oct 12, 2023"` (F3) |
| `illustration_url` | `text` | NULL |
| `word_count` | `integer` | NULL (F5) |
| `created_at` | `timestamptz` | DEFAULT `now()` |

Ràng buộc then chốt (**F2**): `UNIQUE (novel_id, slug)` và `UNIQUE (novel_id, number)`.
Index: `idx_chapters_novel_number ON chapters(novel_id, number)`.

**`chapter_contents`** — `chapter_id uuid PK FK → chapters(id) ON DELETE CASCADE`,
`paragraphs text[] NOT NULL`, `updated_at timestamptz`.
> Tách bảng để `GET /api/novels/:slug` (trả 243 chương) không phải kéo theo toàn bộ text.
> `text[]` map 1-1 với `Chapter.content: string[]`.

**`bookmarks`** — PK `(user_id, novel_id)`, cả hai FK `ON DELETE CASCADE`, `created_at`.

**`reading_progress`**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `user_id` | `uuid` | FK → `users(id)` CASCADE |
| `novel_id` | `uuid` | FK → `novels(id)` CASCADE |
| `last_chapter_id` | `uuid` | FK → `chapters(id)` `ON DELETE SET NULL`, NULL |
| `progress` | `smallint` | NOT NULL DEFAULT 0, `CHECK (progress BETWEEN 0 AND 100)` |
| `updated_at` | `timestamptz` | NOT NULL DEFAULT `now()` |

PK `(user_id, novel_id)`. Index `idx_reading_progress_user_updated (user_id, updated_at DESC)`
cho `GET /api/library/history`.

**`chapter_reads`** — PK `(user_id, chapter_id)`, `read_at timestamptz DEFAULT now()`.
Index `(user_id, read_at DESC)` để tính `streakDays` và `chaptersRead`.

**`group_follows`** — PK `(user_id, group_id)`, `created_at`.

**`novel_recommendations`** — PK `(user_id, novel_id)`, `created_at`.
`recommendationsCount` = `COUNT(*)`; `recommendationsAvatars` = `users.avatar_url` LIMIT 3
(mock có đúng 3 avatar, `mockData.ts:27-31`).

**`sync_events`**

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | `uuid` PK | |
| `novel_id` | `uuid` FK → `novels(id)` CASCADE, NOT NULL | F5 — FK thật, hết dangling |
| `translation_group_id` | `uuid` FK → `translation_groups(id)` SET NULL | → `translator` |
| `chapters_added_count` | `integer` NOT NULL `CHECK > 0` | |
| `occurred_at` | `timestamptz` NOT NULL | → `timeAgo` / `month` / `year` (F3) |

Index `idx_sync_events_occurred_at DESC`.

**`sync_runs`** — `id uuid PK`, `started_at timestamptz NOT NULL`, `finished_at timestamptz NULL`,
`status varchar(20) NOT NULL` (`running`/`completed`/`failed`),
`progress_percentage smallint CHECK 0..100`, `next_run_at timestamptz NULL`.
→ cung cấp `nextSyncCountdown` (= `next_run_at - now()`) và `nextSyncPercentage`.

### 5.4 Mapping đầy đủ: Component → API → Table

| Frontend Component | Dữ liệu cần | Backend API | Table(s) |
|---|---|---|---|
| `App.tsx` (state gốc) | `Novel[]` | `GET /api/novels` | `novels`, `novel_genres`, `genres`, `translation_groups`, `chapters` |
| `Header` / `BottomNav` | avatar user | `GET /api/auth/me` | `users` |
| `HomeView` hero | 1 novel theo slug | `GET /api/novels` | `novels` |
| `HomeView` Continue Reading | novel có `lastReadChapterId` | `GET /api/library/history` | `reading_progress`, `novels`, `chapters` |
| `HomeView` Trending | `novels.slice(4,9)` | `GET /api/novels` | `novels` |
| `DiscoverView` | filter genre/status/q | `GET /api/novels?genre=&status=&q=` | `novels`, `novel_genres`, `genres` |
| `SearchModal` | search title/author/genre | `GET /api/novels?q=` | `novels`, `novel_genres`, `genres` |
| `NovelDetailView` header/synopsis | full novel | `GET /api/novels/:slug` | `novels`, `genres`, `translation_groups` |
| `NovelDetailView` chapter list | tất cả chapter + `isRead` | `GET /api/novels/:slug` | `chapters`, `chapter_reads` |
| `NovelDetailView` nút Bookmark | toggle | `POST`/`DELETE /api/novels/:slug/bookmark` | `bookmarks` |
| `NovelDetailView` nút Follow | toggle | `POST`/`DELETE /api/translation-groups/:slug/follow` | `group_follows` |
| `NovelDetailView` sidebar | views / recommendations | `GET /api/novels/:slug` | `novels`, `novel_recommendations`, `users` |
| `NovelDetailView` "You might like" | `allNovels.slice(0,2)` | `GET /api/novels` | `novels` |
| `ReaderView` nội dung | `content[]`, illustration | `GET /api/novels/:slug/chapters/:chapterSlug` | `chapters`, `chapter_contents` |
| `ReaderView` prev/next | mảng chapter theo thứ tự | `GET /api/novels/:slug` | `chapters` |
| `App.handleReadChapter` | mark read + last chapter | `PUT /api/novels/:slug/chapters/:chapterSlug/progress` | `chapter_reads`, `reading_progress` |
| `TimelineView` cards | `TimelineItem[]` | `GET /api/timeline` | `sync_events`, `novels`, `translation_groups` |
| `TimelineView` bento stats | `SyncStats` | `GET /api/timeline/stats` | `sync_events`, `sync_runs`, `novels`, `translation_groups` |
| `ProfileView` header | tên/email/avatar/stats | `GET /api/auth/me` | `users`, `bookmarks`, `chapter_reads` |
| `ProfileView` tab Bookmarks | novel đã bookmark | `GET /api/library/bookmarks` | `bookmarks`, `novels`, `reading_progress` |
| `ProfileView` tab History | novel đã đọc | `GET /api/library/history` | `reading_progress`, `novels`, `chapters` |

---

## 6. ERROR HANDLING & VALIDATION

**Format lỗi (đúng spec anh yêu cầu):**

```jsonc
{ "success": false, "message": "Validation failed", "errors": [
    { "field": "email", "message": "Invalid email address" },
    { "field": "password", "message": "Password must be at least 8 characters" } ] }
```
Khi không có lỗi field-level, `errors` là `[]`.

| HTTP | Khi nào |
|---|---|
| `400` | JSON body sai cú pháp |
| `401` | thiếu / sai / hết hạn token; sai thông tin đăng nhập |
| `403` | token hợp lệ nhưng thiếu quyền |
| `404` | novel / chapter / route không tồn tại |
| `409` | email đã đăng ký; bookmark trùng |
| `422` | zod validation fail |
| `500` | lỗi ngoài dự kiến — **không leak stack trace khi `NODE_ENV=production`** |

Schema zod cần có: `registerSchema`, `loginSchema`, `novelQuerySchema`, `progressSchema`,
`slugParamSchema`, `chapterParamSchema`.

---

## 7. KIỂM TRA TÍNH SẴN SÀNG (checklist Phase 2)

| # | Câu hỏi anh nêu | Trạng thái sau Phase 1 |
|---|---|---|
| 1 | Frontend gọi được API không? | ❌ **Chưa** — frontend chưa có lớp HTTP nào. Xem §8/Q5. |
| 2 | Endpoint có match frontend không? | ✅ Contract đã khoá theo `types.ts`; `id` = slug (F1), chapter nested (F2) |
| 3 | Có lỗi CORS không? | ✅ Đã xác định origin dev `http://localhost:3000` từ `package.json:7` |
| 4 | Có lỗi TypeScript không? | ✅ Backend độc lập, sẽ bật `strict: true` |
| 5 | Deploy Vercel được không? | ✅ `api/index.ts` export default app, không `app.listen()` |

---

## 8. ❓ CÂU HỎI — ĐÃ ĐƯỢC TRẢ LỜI (2026-08-02)

> ### ✅ QUYẾT ĐỊNH CHỐT
>
> | # | Quyết định | Lựa chọn |
> |---|---|---|
> | **Q1** | Format dữ liệu | **(a)** DB lưu số thô + **presenter layer** format ra string cho UI |
> | **Q2** | Sort/paging `/api/novels` | **(a)** `created_at DESC`, không phân trang bắt buộc *(tôi tự chốt)* |
> | **Q3** | Persist `ReaderSettings` | **Không** — frontend không cần *(tôi tự chốt)* |
> | **Q4** | JWT | TTL **7 ngày**, không refresh token, không logout endpoint *(tôi tự chốt)* |
> | **Q5** | Nối frontend | **(c)** Backend **+ nối luôn frontend**, theo hướng **minimal-diff** (xem dưới) |
> | **Q6** | Seed | `schema.sql` chỉ DDL + `seed.sql` **tách riêng**, optional |
> | **Q7** | Supabase password | `.env.example` để trống, user tự điền `.env` |
>
> **Chiến lược thi hành Q5 (minimal-diff):** thêm **file mới** (`src/services/api.ts`,
> `src/context/AuthContext.tsx`, `src/components/AuthModal.tsx`) và chỉ sửa `App.tsx` tại đúng
> chỗ nguồn dữ liệu. Nhờ presenter layer ở Q1, JSON khớp 100% `types.ts` nên
> `HomeView` / `DiscoverView` / `SearchModal` / `TimelineView` / `BottomNav` **không bị sửa dòng nào**.
> `AuthModal` là bắt buộc cho MVP: thiếu nó thì bookmark / continue-reading / history / profile
> đều `401` và app chỉ còn là trình đọc read-only.

<details>
<summary>Nội dung câu hỏi gốc (giữ lại để tham chiếu)</summary>

**Q1 — Format string vs. số thô** *(quan trọng nhất)*

Xem **F3**. Chọn một:
- **(a) [đề xuất]** DB lưu số thô + presenter layer format ra `"2.8M Readers"`, `"12.4k"`,
  `"Oct 12, 2023"`, `"2h ago"`. Frontend chạy ngay, không sửa gì. Đúng cả hai ràng buộc.
- **(b)** API trả số thô (`totalViews: 2800000`). Sạch về kiến trúc nhưng **frontend sẽ hiển thị
  sai** (render `2800000` thay vì `"2.8M Readers"`) → vi phạm "không sửa frontend".
- **(c)** DB lưu luôn string đã format. Đơn giản nhất nhưng không thể sort/filter theo views.

**Q2 — Thứ tự & phân trang `GET /api/novels`**

`HomeView.tsx:24` dùng `novels.slice(4, 9)` làm "Trending" → thứ tự trả về là hợp đồng ngầm.
Anh muốn: (a) `created_at DESC` trả hết, không phân trang *(khớp hành vi hiện tại)*, hay
(b) có phân trang mặc định `limit=50`?

**Q3 — `ReaderSettings` có persist không?**

Hiện là in-memory (`ReaderView.tsx:35-40`), mất khi rời trang. Frontend **không** yêu cầu API.
Có tạo `user_reader_settings` + `GET/PUT /api/me/reader-settings` không? *(Mặc định của tôi: **không**,
vì "không tạo API nếu frontend không cần".)*

**Q4 — JWT TTL & refresh token**

Anh chỉ nêu access token. Xác nhận: TTL **7 ngày**, **không** refresh token, **không** logout
endpoint (client tự xoá token)?

**Q5 — Ai viết lớp HTTP cho frontend?**

Đây là điểm mấu chốt: **backend xong vẫn không thể chạy end-to-end** vì frontend không có
`fetch` nào. Chọn một:
- **(a)** Tôi chỉ làm backend. Anh tự nối frontend sau. *(Đúng nghĩa đen "không thay đổi frontend")*
- **(b)** Tôi làm backend + thêm **một** file mới `src/services/api.ts` bên frontend, không sửa
  file cũ nào.
- **(c)** Tôi làm backend + nối luôn frontend (sửa `App.tsx` và các component).

**Q6 — Seed data**

Anh nói "không dùng fake data". Vậy `database/schema.sql` chỉ có DDL thôi, hay kèm một file
`database/seed.sql` riêng migrate 10 novel trong `mockData.ts` vào Postgres để có gì đó mà test?
*(Đề xuất: file `seed.sql` **tách riêng**, optional, không chạy tự động.)*

</details>

**Q7 — Mật khẩu Supabase**

Connection string anh đưa còn placeholder `[YOUR-PASSWORD]`. Tôi sẽ chỉ ghi
`DATABASE_URL=` rỗng trong `.env.example` — anh tự điền vào `.env` (không commit). Xác nhận?

> ⚠️ **Lưu ý bảo mật:** connection string có mật khẩu thật thì **không** được commit vào git.
> Nếu mật khẩu đã từng bị dán vào chỗ công khai, nên reset trong Supabase Dashboard.

---

## 9. GHI CHÚ SUPABASE (từ kinh nghiệm migration trước)

Áp dụng ngay từ đầu, không để phát hiện muộn:

- **Port 5432 (direct/session) vs 6543 (transaction pooler):** pooler mode transaction **phá vỡ
  prepared statements**. `pg` mặc định không dùng prepared statements nên OK, nhưng migration/DDL
  nên chạy qua **5432**.
- **Vercel serverless + connection pool:** mỗi lambda instance tạo pool riêng → dễ vượt giới hạn
  connection của Supabase. Cấu hình `max: 1` cho Pool trên serverless, hoặc dùng Supabase pooler
  (6543) cho runtime và 5432 cho migration. → Tôi sẽ để **hai biến**: `DATABASE_URL` (runtime) và
  `DIRECT_URL` (migration/DDL).
- **`timestamptz` + Node:** luôn ghi UTC. `pg` trả `Date` object — presenter tự format.
- **`gen_random_uuid()`** có sẵn (pgcrypto), không cần extension thêm trên Supabase.
- **SSL:** Supabase yêu cầu SSL → `ssl: { rejectUnauthorized: false }` trong pool config.

---

## 10. TRẠNG THÁI

- ✅ Phase 1 hoàn tất — đã đọc **14/14 file** trong `E:\Code\Lumiere_frontend`.
- ⏸️ Phase 2 **chưa bắt đầu** — chờ anh trả lời §8.
- 📁 Thư mục `E:\Code\Lumiere_backend` hiện **trống** (chỉ có file này).
- 🔍 Đã kiểm tra: **không còn** backend .NET cũ nào trên `E:\Code` (0 file `.sln`/`.csproj`).
