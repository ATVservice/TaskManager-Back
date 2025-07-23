import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import { login, register } from '../controllers/authController.js';


const router = express.Router();

router.post('/register',authMiddleware,requireAdmin, register);
router.post('/login', login);

export default router;