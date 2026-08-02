# Lumiere Backend

REST API cho Lumiere — Light Novel Portal.
Express + TypeScript (strict) + PostgreSQL (Supabase) qua `pg` thuần, deploy serverless trên Vercel.

> Toàn bộ API được thiết kế từ phân tích code frontend thực tế — xem
> [BACKEND_REQUIREMENTS.md](./BACKEND_REQUIREMENTS.md) để biết mỗi endpoint bắt nguồn từ dòng
> code nào.

---

## Stack

| Thành phần | Lựa chọn |
|---|---|
| Runtime | Node.js >= 18 |
| Ngôn ngữ | TypeScript, `strict: true` |
| Framework | Express 4 |
| Database | PostgreSQL (Supabase) — **`pg` thuần, không ORM** |
| Auth | JWT (HS256) + bcryptjs |
| Validation | zod |
| Security | helmet, cors |
| Logging | morgan |
| Deploy | Vercel serverless (`api/index.ts`) |

---

## Cấu trúc thư mục

```
Lumiere_backend
├── api/index.ts               # entry point Vercel — export default app, KHÔNG listen()
├── database
│   ├── schema.sql             # DDL: 14 bảng + index + FK + constraint + genres
│   └── seed.sql               # dữ liệu mẫu (tuỳ chọn) migrate từ mockData.ts
├── scripts/run-sql.mjs        # chạy file .sql lên Postgres
├── src
│   ├── app.ts                 # cấu hình Express (helmet, cors, morgan, json)
│   ├── server.ts              # server LOCAL — chỉ file này gọi app.listen()
│   ├── config
│   │   ├── env.ts             # đọc + validate biến môi trường (fail-fast)
│   │   └── database.ts        # pg Pool + query/queryOne/withTransaction
│   ├── controllers            # auth, novel, library, timeline
│   ├── routes                 # 15 endpoints
│   ├── middleware
│   │   ├── auth.middleware.ts     # requireAuth / optionalAuth / requireRole
│   │   ├── error.middleware.ts    # error handler toàn cục + 404
│   │   └── validate.middleware.ts # validate bằng zod
│   ├── services               # toàn bộ SQL + business logic
│   ├── models/index.ts        # DTO (khớp frontend types.ts) + Row (khớp DB)
│   ├── schemas                # zod schemas
│   └── utils
│       ├── presenter.ts       # ⭐ format số thô -> chuỗi hiển thị (xem bên dưới)
│       ├── jwt.ts, password.ts, ApiError.ts, response.ts, asyncHandler.ts
├── package.json
├── tsconfig.json
├── vercel.json
├── .env.example
└── BACKEND_REQUIREMENTS.md
```

---

## Bắt đầu nhanh

### 1. Cài đặt

```bash
cd E:\Code\Lumiere_backend
npm install
```

### 2. Cấu hình biến môi trường

```bash
copy .env.example .env      # Windows
# cp .env.example .env      # macOS/Linux
```

Mở `.env` và điền:

```dotenv
# Runtime — trên Vercel dùng transaction pooler (6543) để không cạn connection
DATABASE_URL=postgresql://postgres:<PASSWORD>@db.jwghcqqnykjxjmmxxydd.supabase.co:5432/postgres

# Direct connection (5432) — dùng cho DDL/migration
DIRECT_URL=postgresql://postgres:<PASSWORD>@db.jwghcqqnykjxjmmxxydd.supabase.co:5432/postgres

JWT_SECRET=<sinh bằng lệnh bên dưới>
FRONTEND_URL=http://localhost:3000
PORT=4000
```

Sinh `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

> ⚠️ **Không commit `.env`.** File này chứa mật khẩu database. `.gitignore` đã loại trừ sẵn.
> Lấy mật khẩu Supabase tại **Project Settings → Database → Database password**.

### 3. Chạy migration lên Supabase

```bash
npm run db:schema     # tạo bảng, index, FK, constraint, và danh sách genres
npm run db:seed       # (tuỳ chọn) nạp 10 novel mẫu migrate từ mockData.ts
```

Cả hai script đều **idempotent** — chạy lại nhiều lần không lỗi.

<details>
<summary>Cách khác: chạy tay qua Supabase SQL Editor</summary>

Nếu không muốn dùng script: mở Supabase Dashboard → **SQL Editor** → dán nội dung
`database/schema.sql` → Run. Sau đó làm tương tự với `database/seed.sql`.
</details>

### 4. Chạy dev server

```bash
npm run dev
```

```
✅ Kết nối PostgreSQL thành công
🚀 Lumiere API đang chạy tại http://localhost:4000
   Health check: http://localhost:4000/api/health
```

Kiểm tra nhanh:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/novels
```

### 5. Chạy frontend

```bash
cd E:\Code\Lumiere_frontend
npm install
npm run dev          # http://localhost:3000
```

Frontend mặc định gọi `http://localhost:4000`. Muốn đổi thì tạo `.env.local`:

```dotenv
VITE_API_URL=http://localhost:4000
```

---

## Scripts

| Lệnh | Mô tả |
|---|---|
| `npm run dev` | Dev server + watch (tsx), có kiểm tra kết nối DB lúc khởi động |
| `npm run build` | Biên dịch TypeScript sang `dist/` |
| `npm start` | Chạy bản đã build |
| `npm run typecheck` | `tsc --noEmit` — kiểm tra kiểu, không sinh file |
| `npm run db:schema` | Chạy `database/schema.sql` |
| `npm run db:seed` | Chạy `database/seed.sql` |

---

## API Reference

Base URL: `/api` · Auth: `Authorization: Bearer <token>`

**Envelope thành công**
```json
{ "success": true, "data": {} }
```

**Envelope lỗi**
```json
{ "success": false, "message": "Validation failed", "errors": [{ "field": "email", "message": "Invalid email address" }] }
```

### Endpoints

| Method | Endpoint | Auth | Mô tả |
|---|---|:---:|---|
| `GET` | `/api/health` | — | Health check |
| `POST` | `/api/auth/register` | — | Đăng ký, trả `{ token, user }` |
| `POST` | `/api/auth/login` | — | Đăng nhập, trả `{ token, user }` |
| `GET` | `/api/auth/me` | 🔒 | Thông tin user + `stats` |
| `GET` | `/api/novels` | ○ | Danh sách novel (`?q=&genre=&status=&limit=&offset=`) |
| `GET` | `/api/novels/:slug` | ○ | Chi tiết + **đầy đủ** chapters |
| `GET` | `/api/novels/:slug/chapters/:chapterSlug` | ○ | Nội dung chương (`content: string[]`) |
| `POST` | `/api/novels/:slug/bookmark` | 🔒 | Thêm bookmark |
| `DELETE` | `/api/novels/:slug/bookmark` | 🔒 | Bỏ bookmark |
| `PUT` | `/api/novels/:slug/chapters/:chapterSlug/progress` | 🔒 | Đánh dấu đã đọc + vị trí đọc |
| `GET` | `/api/library/bookmarks` | 🔒 | Novel đã bookmark |
| `GET` | `/api/library/history` | 🔒 | Lịch sử đọc |
| `GET` | `/api/timeline` | ○ | Sync log |
| `GET` | `/api/timeline/stats` | ○ | Thống kê sync |
| `POST` | `/api/translation-groups/:slug/follow` | 🔒 | Follow nhóm dịch |
| `DELETE` | `/api/translation-groups/:slug/follow` | 🔒 | Unfollow nhóm dịch |

🔒 bắt buộc đăng nhập · ○ **optionalAuth**: xem được khi là khách, nhưng có token thì response
kèm thêm state riêng (`isBookmarked`, `lastReadChapterId`, `chapter.isRead`).

### Ví dụ

```bash
# Đăng ký
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"reader@lumiere.app","password":"SecurePass123","displayName":"Archivist Traveler"}'

# Đăng nhập
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"reader@lumiere.app","password":"SecurePass123"}' | jq -r '.data.token')

# Gọi endpoint cần auth
curl http://localhost:4000/api/auth/me -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:4000/api/novels/eternal-archive/bookmark -H "Authorization: Bearer $TOKEN"
curl http://localhost:4000/api/library/bookmarks -H "Authorization: Bearer $TOKEN"

# Nội dung chương
curl http://localhost:4000/api/novels/eternal-archive/chapters/ch-42
```

---

## Hai quyết định thiết kế cần biết

### 1. `id` trong API là **slug**, không phải UUID

Frontend hardcode slug ở nhiều chỗ — `'eternal-archive'`, `'shadow-of-the-void'`, `'ch-42'`.
Vì vậy DB dùng `uuid` làm khoá chính nội bộ và có thêm cột `slug UNIQUE`; layer serialize trả
`slug` ra field `id`.

Hệ quả: **chapter bắt buộc nested dưới novel**. `ch-42` tồn tại ở cả `shadow-of-the-void` lẫn
`eternal-archive`, nên không có route `/api/chapters/:id`, và ràng buộc là
`UNIQUE (novel_id, slug)`.

### 2. Presenter layer — DB lưu số thô, API trả chuỗi đã format

Database lưu `total_views BIGINT`, `ratings_count INTEGER`, `published_at TIMESTAMPTZ` nên vẫn
sort/filter/aggregate được. Nhưng frontend render thẳng các giá trị đó ra JSX và mong đợi chuỗi
đã format sẵn.

[`src/utils/presenter.ts`](./src/utils/presenter.ts) là cầu nối:

| DB (số thô) | API (chuỗi) |
|---|---|
| `total_views = 2800000` | `"totalViews": "2.8M Readers"` |
| `ratings_count = 12400` | `"ratingsCount": "12.4k"` |
| `recommendations_count = 8000` | `"recommendationsCount": "+8k"` |
| `published_at = 2023-10-12T00:00:00Z` | `"date": "Oct 12, 2023"` |
| `occurred_at` (2 giờ trước) | `"timeAgo": "2h ago"` |

Nhờ vậy frontend chạy mà không phải sửa component nào. Khi muốn chuyển sang raw API, chỉ cần
bỏ lớp này đi.

---

## Deploy lên Vercel

### 1. Chuẩn bị

`api/index.ts` chỉ `export default app` và **không gọi `app.listen()`** — trên serverless,
Vercel tự quản lý vòng đời request; gọi `listen()` sẽ khiến function treo tới khi timeout.

### 2. Deploy

```bash
npm i -g vercel
vercel login
vercel            # preview
vercel --prod     # production
```

Hoặc nối GitHub repo trong Vercel Dashboard → **Import Project**.

### 3. Đặt biến môi trường trên Vercel

**Project Settings → Environment Variables**:

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | Connection string Supabase — **dùng pooler port `6543`** |
| `DIRECT_URL` | Connection string port `5432` (cho migration) |
| `JWT_SECRET` | Secret ngẫu nhiên đủ dài (>= 32 ký tự, nếu không app sẽ từ chối khởi động) |
| `FRONTEND_URL` | Domain frontend đã deploy, VD `https://lumiere.vercel.app` |
| `NODE_ENV` | `production` |

> **Vì sao port 6543 cho runtime?** Mỗi lambda instance tạo pool riêng. Với connection limit của
> Supabase, vài instance đồng thời là cạn. Pool đã cấu hình `max: 1` khi phát hiện chạy trên
> Vercel, cộng với transaction pooler của Supabase để ghép nối.
>
> **Vì sao 5432 cho migration?** Transaction pooler không chạy DDL và advisory lock một cách
> tin cậy.

### 4. Sau khi deploy

```bash
curl https://<your-app>.vercel.app/api/health
```

Rồi cập nhật `VITE_API_URL` bên frontend trỏ tới domain vừa deploy.

---

## Kiểm tra & khắc phục sự cố

| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| `Thiếu biến môi trường bắt buộc: DATABASE_URL` | Chưa tạo `.env` hoặc để trống. Copy từ `.env.example`. |
| `JWT_SECRET ngắn hơn 32 ký tự` | Cảnh báo ở dev, **chặn khởi động** ở production. Sinh secret mới. |
| `Database schema is not initialised` | Chưa chạy `npm run db:schema`. |
| `password authentication failed` | Sai mật khẩu trong `DATABASE_URL`. Lấy lại ở Supabase → Settings → Database. |
| Frontend báo lỗi CORS | `FRONTEND_URL` phải khớp **chính xác** origin của frontend (kể cả port). Nhiều origin thì phân tách bằng dấu phẩy. |
| `Không kết nối được tới API tại http://localhost:4000` | Backend chưa chạy, hoặc `VITE_API_URL` trỏ sai. |
| API trả mảng rỗng | Chưa chạy `npm run db:seed`, hoặc DB thật sự chưa có dữ liệu. |
| Bookmark/History trả `401` | Chưa đăng nhập. Bấm vào avatar góc phải để mở form đăng nhập. |

Kiểm tra kiểu bất cứ lúc nào:

```bash
npm run typecheck      # backend
cd ..\Lumiere_frontend && npx tsc --noEmit   # frontend
```

---

## Ghi chú về phía frontend

Frontend đã được nối sẵn với API này. Các file **mới thêm**:

- `src/services/api.ts` — HTTP client có type đầy đủ cho cả 15 endpoint
- `src/context/AuthContext.tsx` — trạng thái đăng nhập, tự khôi phục phiên
- `src/components/AuthModal.tsx` — form đăng nhập/đăng ký

Các file **được sửa**: `App.tsx`, `main.tsx`, `types.ts`, `Header.tsx`, `ProfileView.tsx`,
`NovelDetailView.tsx`.

Các file **không đụng tới**: `HomeView.tsx`, `DiscoverView.tsx`, `SearchModal.tsx`,
`TimelineView.tsx`, `ReaderView.tsx`, `BottomNav.tsx`, `index.css` — chính là nhờ presenter
layer khiến JSON khớp 1-1 với `types.ts` sẵn có."# lumiere_backend" 
