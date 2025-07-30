import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { getCancelledTasks, getCompletedTasks, getDrawerTasks, getRecurringTasks } from '../controllers/taskFiltersController.js';

const router = express.Router();


router.get('/completed', authMiddleware, asyncHandler(getCompletedTasks));
router.get('/cancelled', authMiddleware, asyncHandler(getCancelledTasks));
router.get('/drawer', authMiddleware, asyncHandler(getDrawerTasks));
router.get('/recurringTasks', authMiddleware, asyncHandler(getRecurringTasks));



export default router;