import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import { addAssociationToUsers, createAssociation, getAllAssociations, getAssociatedEmployees } from '../controllers/associationController.js';


const router = express.Router();

router.post('/createAssociation',authMiddleware, requireAdmin, createAssociation);
router.get('/getAllAssociations',authMiddleware, requireAdmin, getAllAssociations);
router.get('/getAssociated/:associationId',authMiddleware, requireAdmin, getAssociatedEmployees);
router.put('/addAssociationToUsers', authMiddleware, requireAdmin, addAssociationToUsers);

export default router;