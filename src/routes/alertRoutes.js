import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { getUserAlerts, markRead } from '../controllers/alertController.js';

const router = express.Router();


router.get('/getUserAlerts', authMiddleware, asyncHandler(getUserAlerts));
router.post('/markRead', authMiddleware, asyncHandler(markRead));


export default router;