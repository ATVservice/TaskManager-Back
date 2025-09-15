import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { addProject, getAllProjectNames } from '../controllers/projectController.js';

const router = express.Router();


router.get('/getAllProjectNames', authMiddleware, asyncHandler(getAllProjectNames));
router.post('/addProject', authMiddleware, asyncHandler(addProject));

export default router;