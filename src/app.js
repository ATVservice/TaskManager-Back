import express from 'express';
import associationRoutes from './routes/associationRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
const app = express();
app.use(express.json());

app.use('/api/associations', associationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

export default app;
