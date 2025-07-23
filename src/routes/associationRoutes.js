import express from 'express';
import { createAssociation, getAllAssociations } from '../controllers/associationController.js';


const router = express.Router();

router.post('/createAssociation', createAssociation);
router.get('/getAllAssociations', getAllAssociations);

export default router;