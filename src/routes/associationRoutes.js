import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import {asyncHandler} from '../middleware/asyncHandler.js';
import { addAssociationToUsers, createAssociation, getAllAssociations, getAssociatedEmployees } from '../controllers/associationController.js';


const router = express.Router();

router.post('/createAssociation',authMiddleware, requireAdmin, asyncHandler(createAssociation));
router.get('/getAllAssociations',authMiddleware, requireAdmin, asyncHandler(getAllAssociations));
router.get('/getAssociated/:associationId',authMiddleware, requireAdmin, asyncHandler(getAssociatedEmployees));
router.put('/addAssociationToUsers', authMiddleware, requireAdmin, asyncHandler(addAssociationToUsers));

export default router;