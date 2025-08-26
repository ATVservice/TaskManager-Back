import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { getGeneralSummary } from '../controllers/adminDashboardController.js';


const router = express.Router();

router.get('/getGeneralSummary',authMiddleware,requireAdmin, asyncHandler(getGeneralSummary));


export default router;