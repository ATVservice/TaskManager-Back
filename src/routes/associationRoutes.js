import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import  asyncHandler  from '../middleware/asyncHandler.js';
import { createAssociation, getAllAssociations, getAssociatedEmployees, updateAssociationUsers } from '../controllers/associationController.js';


const router = express.Router();

router.post('/createAssociation',authMiddleware, requireAdmin, asyncHandler(createAssociation));
router.get('/getAllAssociations',authMiddleware, asyncHandler(getAllAssociations));
router.get('/getAssociated/:associationId',authMiddleware, requireAdmin, asyncHandler(getAssociatedEmployees));
router.put('/updateAssociationUsers', authMiddleware, requireAdmin, asyncHandler(updateAssociationUsers));

export default router;