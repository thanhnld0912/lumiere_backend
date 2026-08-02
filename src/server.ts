/**
 * Server cho môi trường LOCAL.
 *
 * Chỉ file này được phép gọi app.listen(). Vercel dùng api/index.ts và không
 * bao giờ chạm tới file này (tsconfig vẫn compile nó, nhưng vercel.json chỉ
 * build api/index.ts).
 */
import app from './app';
import { closePool, query } from './config/database';
import { env } from './config/env';

async function start(): Promise<void> {
  // Kiểm tra kết nối DB NGAY lúc khởi động: thà fail rõ ràng ở đây còn hơn để
  // request đầu tiên trả 500 mà không rõ nguyên nhân.
  try {
    await query('SELECT 1');
    console.log('✅ Kết nối PostgreSQL thành công');
  } catch (error) {
    console.error('❌ Không kết nối được PostgreSQL:', (error as Error).message);
    console.error('   Kiểm tra DATABASE_URL trong .env');
    process.exit(1);
  }

  const server = app.listen(env.port, () => {
    console.log(`🚀 Lumiere API đang chạy tại http://localhost:${env.port}`);
    console.log(`   Health check: http://localhost:${env.port}/api/health`);
    console.log(`   CORS cho phép: ${env.corsOrigins.join(', ')}`);
  });

  const shutdown = (signal: string): void => {
    console.log(`\n${signal} — đang tắt server...`);
    server.close(() => {
      void closePool().then(() => {
        console.log('Đã đóng kết nối. Tạm biệt.');
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void start();