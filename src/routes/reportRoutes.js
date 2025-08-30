import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { getEmployeePersonalStats, getOpenTasksByEmployee, getOverdueTasks, getTasksByFailureReason, getTasksByResponsibility, getTasksSummaryByPeriod } from '../controllers/reportController.js';


const router = express.Router();

router.get('/getOpenTasksByEmployee',authMiddleware,requireAdmin, asyncHandler(getOpenTasksByEmployee));
router.get('/getTasksByResponsibility',authMiddleware,requireAdmin, asyncHandler(getTasksByResponsibility));
router.get('/getOverdueTasks',authMiddleware,requireAdmin, asyncHandler(getOverdueTasks));
router.get('/getTasksSummaryByPeriod',authMiddleware,requireAdmin, asyncHandler(getTasksSummaryByPeriod));
router.get('/getEmployeePersonalStats',authMiddleware,requireAdmin, asyncHandler(getEmployeePersonalStats));
router.get('/getTasksByFailureReason',authMiddleware,requireAdmin, asyncHandler(getTasksByFailureReason));


export default router;