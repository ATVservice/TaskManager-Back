import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/permissionMiddleware.js';
import { createAssociation, getAllAssociations } from '../controllers/associationController.js';


const router = express.Router();

router.post('/createAssociation',authMiddleware, requireAdmin, createAssociation);
router.get('/getAllAssociations',authMiddleware, requireAdmin, getAllAssociations);

export default router;