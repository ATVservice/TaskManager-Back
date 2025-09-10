import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { updateTask } from '../controllers/updateTaskController.js';
import { updateRecurringTask } from '../controllers/updateRecurringTaskController.js';
import { getTaskHistory } from '../controllers/taskHistoryController.js';
import { getRecurringTaskHistory } from '../controllers/recurringTaskHistoryController.js';

const router = express.Router();


router.put('/updateTask/:taskId', authMiddleware, asyncHandler(updateTask));
router.put('/updateRecurringTask/:taskId', authMiddleware, asyncHandler(updateRecurringTask));
router.get('/history/:taskId', authMiddleware, asyncHandler(getTaskHistory));
router.get('/recurringHistory/:taskId', authMiddleware, asyncHandler(getRecurringTaskHistory));



export default router;