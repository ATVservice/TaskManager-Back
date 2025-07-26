import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
// import { requireAdmin } from '../middleware/permissionMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { createTask } from '../controllers/taskController.js';


const router = express.Router();

router.post('/createTask',authMiddleware, asyncHandler(createTask));

export default router;