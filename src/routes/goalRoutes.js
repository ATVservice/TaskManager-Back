import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { createGoal } from '../controllers/goalController.js';


const router = express.Router();

router.post('/createGoal',authMiddleware,requireAdmin, asyncHandler(createGoal));

export default router;