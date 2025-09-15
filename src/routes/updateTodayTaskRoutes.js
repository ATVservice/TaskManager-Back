import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { completeRecurringTask } from '../controllers/updateTodayTaskController.js';

const router = express.Router();

router.put('/completeRecurringTask/:taskId', authMiddleware, asyncHandler(completeRecurringTask));




export default router;