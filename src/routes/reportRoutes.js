import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { employeeStatistics, openTasksByEmployee, overdueTasks, tasksByOrganization, taskSummary } from '../controllers/reportController.js';


const router = express.Router();

router.get('/openTasksByEmployee',authMiddleware,requireAdmin, asyncHandler(openTasksByEmployee));
router.get('/overdueTasks',authMiddleware,requireAdmin, asyncHandler(overdueTasks));
router.get('/taskSummary',authMiddleware,requireAdmin, asyncHandler(taskSummary));
router.get('/employeeStatistics',authMiddleware,requireAdmin, asyncHandler(employeeStatistics));
router.get('/tasksByOrganization',authMiddleware,requireAdmin, asyncHandler(tasksByOrganization));


export default router;