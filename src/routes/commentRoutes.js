import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { addComment, getComments } from '../controllers/commentController.js';

const router = express.Router();


router.get('/getComments', authMiddleware, asyncHandler(getComments));
router.post('/addComment', authMiddleware, asyncHandler(addComment));

export default router;