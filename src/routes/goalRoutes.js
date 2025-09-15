import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { createGoal, getGoalsByEmployee } from '../controllers/goalController.js';


const router = express.Router();

router.post('/createGoal',authMiddleware,requireAdmin, asyncHandler(createGoal));
router.get('/getGoalsByEmployee/:employeeId',authMiddleware, asyncHandler(getGoalsByEmployee));


export default router;