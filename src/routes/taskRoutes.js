import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
// import { requireAdmin } from '../middleware/permissionMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { createTask, duplicateTask, getMoreDetails, getTasks } from '../controllers/taskController.js';
import { getTodayTasks } from '../controllers/todayTasksController.js';


const router = express.Router();

router.post('/createTask',authMiddleware, asyncHandler(createTask));
router.post('/duplicateTask',authMiddleware, asyncHandler(duplicateTask));
router.get('/getTasks',authMiddleware, asyncHandler(getTasks));
router.get('/getTodayTasks',authMiddleware, asyncHandler(getTodayTasks));
router.get('/getMoreDetails/:_id',authMiddleware, asyncHandler(getMoreDetails));



export default router;