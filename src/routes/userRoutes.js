import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import { getAllEmployees, updateUser } from '../controllers/userController.js';


const router = express.Router();

router.put('/updateUser/:id',authMiddleware,requireAdmin, updateUser);
router.get('/getAllEmployees',authMiddleware, requireAdmin, getAllEmployees);

export default router;