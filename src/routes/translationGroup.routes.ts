import { Router } from 'express';
import * as libraryController from '../controllers/library.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { groupSlugParamSchema } from '../schemas/novel.schema';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.post(
  '/:slug/follow',
  requireAuth,
  validate(groupSlugParamSchema, 'params'),
  asyncHandler(libraryController.followGroup),
);

router.delete(
  '/:slug/follow',
  requireAuth,
  validate(groupSlugParamSchema, 'params'),
  asyncHandler(libraryController.unfollowGroup),
);

export default router;