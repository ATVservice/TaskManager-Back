import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { getUserPerformance } from '../controllers/dashboardController.js';

const router = express.Router();


router.get('/getUserPerformance', authMiddleware, asyncHandler(getUserPerformance));




export default router;