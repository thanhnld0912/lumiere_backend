/**
 * Entry point cho Vercel serverless.
 *
 * KHÔNG gọi app.listen() ở đây — trên serverless, Vercel tự bọc handler được
 * export và quản lý vòng đời request. Gọi listen() sẽ khiến function treo cho
 * tới khi timeout.
 *
 * Chạy server local thì dùng `npm run dev` (src/server.ts) — file đó mới listen.
 */
import app from '../src/app';

export default app;