import express from 'express';
import associationRoutes from './routes/associationRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import taskFiltersRoutes from './routes/taskFiltersRoutes.js';
import cors from 'cors';
import errorHandler from './middleware/errorMiddleware.js';


const app = express();
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
  }));
  
  app.use(express.json());
app.use(express.json());

app.use('/api/associations', associationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/taskFilters', taskFiltersRoutes);





app.use(errorHandler);
export default app;
