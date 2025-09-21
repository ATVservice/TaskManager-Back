import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { softDeleteTask } from '../controllers/deleteTaskController.js';

const router = express.Router();


router.put('/softDeleteTask/:taskId/:isTodayTask', authMiddleware, asyncHandler(softDeleteTask));



export default router;