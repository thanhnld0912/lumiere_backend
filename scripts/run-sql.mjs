/**
 * Chạy một file .sql lên PostgreSQL.
 *
 *   node scripts/run-sql.mjs database/schema.sql
 *   node scripts/run-sql.mjs database/seed.sql
 *
 * Ưu tiên DIRECT_URL (port 5432) vì DDL và advisory lock không chạy tin cậy qua
 * transaction pooler của Supabase (port 6543). Không có DIRECT_URL thì fallback
 * về DATABASE_URL.
 *
 * File .mjs thuần Node, không qua TypeScript — để chạy được cả khi build lỗi.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const file = process.argv[2];
if (!file) {
  console.error('Thiếu tham số. Ví dụ: node scripts/run-sql.mjs database/schema.sql');
  process.exit(1);
}

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Thiếu DIRECT_URL và DATABASE_URL trong .env');
  process.exit(1);
}

if (!process.env.DIRECT_URL && connectionString.includes(':6543')) {
  console.warn(
    '⚠️  Đang dùng transaction pooler (port 6543) để chạy DDL. ' +
      'Nên đặt DIRECT_URL trỏ tới port 5432.',
  );
}

const path = resolve(process.cwd(), file);
const sql = await readFile(path, 'utf8');

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log(`▶  Đang chạy ${file} ...`);
  await client.query(sql);
  console.log(`✅ Xong: ${file}`);
} catch (error) {
  console.error(`❌ Lỗi khi chạy ${file}:`);
  console.error(`   ${error.message}`);
  if (error.position) console.error(`   Vị trí ký tự: ${error.position}`);
  if (error.detail) console.error(`   Chi tiết: ${error.detail}`);
  process.exitCode = 1;
} finally {
  await client.end();
}