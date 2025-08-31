import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { getEmployeePersonalStats, getOpenTasksByEmployee, getOverdueTasks, getTasksByResponsibility, getTasksSummaryByPeriod, loadSavedFilter, resetFilter } from '../controllers/reportController.js';


const router = express.Router();

router.get('/getOpenTasksByEmployee', authMiddleware, requireAdmin, asyncHandler(getOpenTasksByEmployee));
router.get('/getTasksByResponsibility', authMiddleware, requireAdmin, asyncHandler(getTasksByResponsibility));
router.get('/getOverdueTasks', authMiddleware, requireAdmin, asyncHandler(getOverdueTasks));
router.get('/getTasksSummaryByPeriod', authMiddleware, requireAdmin, asyncHandler(getTasksSummaryByPeriod));
router.get('/getEmployeePersonalStats', authMiddleware, requireAdmin, asyncHandler(getEmployeePersonalStats));
router.get('/loadSavedFilter/:screenType', authMiddleware, requireAdmin, asyncHandler(loadSavedFilter));
router.delete('/resetFilter/:screenType', authMiddleware, requireAdmin, asyncHandler(resetFilter));


export default router;