import express from 'express';
import associationRoutes from './routes/associationRoutes.js';
import authRoutes from './routes/authRoutes.js';
const app = express();
app.use(express.json());

app.use('/api/associations', associationRoutes);
app.use('/api/auth', authRoutes);

export default app;
