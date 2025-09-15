import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { getAllDeletedTasks, restoreTask } from '../controllers/restoreTaskController.js';

const router = express.Router();


router.get('/getAllDeletedTasks', authMiddleware, asyncHandler(getAllDeletedTasks));
router.put('/restoreTask/:taskId', authMiddleware, asyncHandler(restoreTask));





export default router;