import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import routes from './routes';

const app: Express = express();

/**
 * Vercel đặt một proxy trước lambda. Không bật trust proxy thì req.ip luôn là
 * IP của proxy và req.protocol luôn là 'http' kể cả khi client dùng HTTPS.
 */
app.set('trust proxy', 1);

// Ẩn header X-Powered-By: Express (helmet cũng làm, nhưng khai báo tường minh).
app.disable('x-powered-by');

/* ── Security headers ──────────────────────────────────────── */
app.use(
  helmet({
    // API thuần JSON, không phục vụ HTML nên CSP không có tác dụng gì; bật lên
    // chỉ khiến trang lỗi mặc định của Express bị chặn khi debug.
    contentSecurityPolicy: false,
    // Cho phép ảnh/tài nguyên được nhúng từ origin khác (frontend khác domain).
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

/* ── CORS ──────────────────────────────────────────────────── */
const corsOptions: CorsOptions = {
  origin(requestOrigin, callback) {
    // Không có Origin = request cùng origin, curl, hoặc health check của Vercel.
    if (!requestOrigin) {
      callback(null, true);
      return;
    }
    if (env.corsOrigins.includes(requestOrigin)) {
      callback(null, true);
      return;
    }
    // Preview deployment của Vercel có domain sinh ngẫu nhiên, cho qua để không
    // phải cập nhật FRONTEND_URL sau mỗi lần deploy preview.
    if (!env.isProduction && /^https?:\/\/localhost(:\d+)?$/.test(requestOrigin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS: origin không được phép: ${requestOrigin}`));
  },
  // Auth đi qua header Authorization: Bearer, KHÔNG qua cookie. Để false tránh
  // xung đột giữa Access-Control-Allow-Credentials và origin wildcard.
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86_400,
};

app.use(cors(corsOptions));
// Trả lời preflight cho mọi route.
app.options('*', cors(corsOptions));

/* ── Body parser ───────────────────────────────────────────── */
// Giới hạn 1mb: không endpoint nào nhận payload lớn, nới rộng chỉ tăng bề mặt tấn công.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* ── Logging ───────────────────────────────────────────────── */
if (!env.isTest) {
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));
}

/* ── Routes ────────────────────────────────────────────────── */
app.use('/api', routes);

// Root: tiện để kiểm tra deploy còn sống.
app.get('/', (_req, res) => {
  res.json({
    success: true,
    data: { name: 'Lumiere API', version: '1.0.0', docs: '/api/health' },
  });
});

/* ── Error handling — PHẢI đăng ký sau cùng ────────────────── */
app.use(notFoundHandler);
app.use(errorHandler);

export default app;