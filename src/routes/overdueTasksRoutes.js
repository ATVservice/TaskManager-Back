import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { getOverdueTasksForUser, populateDelayedTasks, updatedueDateWithDelayedLogic, updateStatusWithDelayedLogic } from '../controllers/overdueTasksController.js';

const router = express.Router();


router.get('/getOverdueTasks', authMiddleware, asyncHandler(getOverdueTasksForUser));
router.put('/updateStatusDelayed/:taskId', authMiddleware, asyncHandler(updateStatusWithDelayedLogic));
router.put('/updatedueDate/:taskId', authMiddleware, asyncHandler(updatedueDateWithDelayedLogic));


export default router;