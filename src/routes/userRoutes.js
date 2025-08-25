import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import asyncHandler from '../middleware/asyncHandler.js';
import { deleteUser, getAllEmployees, getNamesEmployees, getUserNamesEmployees, updateUser } from '../controllers/userController.js';


const router = express.Router();

router.put('/updateUser/:id',authMiddleware,requireAdmin, asyncHandler(updateUser));
router.delete('/deleteUser/:id',authMiddleware,requireAdmin, asyncHandler(deleteUser));
router.get('/getAllEmployees',authMiddleware, requireAdmin, asyncHandler(getAllEmployees));
router.get('/getUserNamesEmployees',authMiddleware, asyncHandler(getUserNamesEmployees));
router.get('/getNamesEmployees',authMiddleware, asyncHandler(getNamesEmployees));

export default router;