import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import {asyncHandler} from '../middleware/asyncHandler.js';
import { login, register } from '../controllers/authController.js';


const router = express.Router();

router.post('/register',authMiddleware,requireAdmin, asyncHandler(register));
router.post('/login', asyncHandler(login));

export default router;