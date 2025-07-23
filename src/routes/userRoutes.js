import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import {asyncHandler} from '../middleware/asyncHandler.js';
import { getAllEmployees, updateUser } from '../controllers/userController.js';


const router = express.Router();

router.put('/updateUser/:id',authMiddleware,requireAdmin, asyncHandler(updateUser));
router.get('/getAllEmployees',authMiddleware, requireAdmin, asyncHandler(getAllEmployees));

export default router;