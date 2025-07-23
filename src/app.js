import express from 'express';
import associationRoutes from './routes/associationRoutes.js';
const app = express();
app.use(express.json());


app.use('/api/associations', associationRoutes);
export default app;
