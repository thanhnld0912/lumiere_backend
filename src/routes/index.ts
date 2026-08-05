import { Router } from 'express';
import adminRoutes from './admin.routes';
import authRoutes from './auth.routes';
import libraryRoutes from './library.routes';
import novelRoutes from './novel.routes';
import timelineRoutes from './timeline.routes';
import translationGroupRoutes from './translationGroup.routes';

const router = Router();

/** Health check — dùng để kiểm tra deploy và kết nối DB. */
router.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/novels', novelRoutes);
router.use('/library', libraryRoutes);
router.use('/timeline', timelineRoutes);
router.use('/translation-groups', translationGroupRoutes);

export default router;