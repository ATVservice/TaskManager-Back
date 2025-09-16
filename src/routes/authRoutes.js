import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { forgotPassword, login, refreshToken, register, resetPassword } from '../controllers/authController.js';


const router = express.Router();

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
router.post('/refreshToken',authMiddleware, asyncHandler(refreshToken));
router.post('/forgotPassword', asyncHandler(forgotPassword));
router.post('/resetPassword', asyncHandler(resetPassword));



export default router;