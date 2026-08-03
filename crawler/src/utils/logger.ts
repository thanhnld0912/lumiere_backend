import pino, { type Logger } from 'pino';
import { env, isProduction } from '../config/env.js';

/**
 * Logger dùng chung.
 *
 * Production (GitHub Actions): JSON một dòng — đọc được bằng máy, và log của
 * Actions vốn là plain text nên định dạng có màu chỉ làm nhiễu.
 * Local: pino-pretty cho dễ đọc.
 */
export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  base: undefined, // bỏ pid/hostname — vô nghĩa trên CI runner ephemeral
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
});

/**
 * Logger con gắn ngữ cảnh cố định.
 *
 * Dùng ở mọi tầng để log tự nói rõ nó đến từ đâu — với crawler chạy 5.000 novel
 * thì log không có ngữ cảnh là log vô dụng.
 *
 * @example
 *   const log = childLogger({ source: 'novelupdates', mode: 'refresh' });
 *   log.info({ externalId: '12345' }, 'crawled');
 */
export function childLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}
