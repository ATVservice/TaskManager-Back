import express from 'express';
import associationRoutes from './routes/associationRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import deleteTaskRoutes from './routes/deleteTaskRoutes.js';
import updateTaskRoutes from './routes/updateTaskRoutes.js'
import updateTodayTask from "./routes/updateTodayTaskRoutes.js"
import restoreTaskRoutes from './routes/restoreTaskRoutes.js'
import taskFiltersRoutes from './routes/taskFiltersRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js'
import adminDashboardRoutes from './routes/adminDashboardRoutes.js'
import alertRoutes from './routes/alertRoutes.js'
import goalRoutes from './routes/goalRoutes.js'
import reportRoutes from './routes/reportRoutes.js'
import projectRoutes from './routes/projectRoutes.js'
import commentRoutes  from './routes/commentRoutes.js';

import cors from 'cors';
import errorHandler from './middleware/errorMiddleware.js';
import path from "path";
import { fileURLToPath } from "url";
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const app = express();

app.use(cors({
  origin: [
    'https://taskmanager-front-production.up.railway.app',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

  
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Server is running');
});

app.use('/api/associations', associationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/taskFilters', taskFiltersRoutes);
app.use('/api/delete', deleteTaskRoutes);
app.use('/api/restore', restoreTaskRoutes);
app.use('/api/update',updateTaskRoutes);
app.use('/api/updateToday',updateTodayTask);
app.use('/api/alert',alertRoutes);
app.use('/api/dashboard',dashboardRoutes)
app.use('/api/goal',goalRoutes)
app.use('/api/report',reportRoutes)
app.use('/api/adminDashboard',adminDashboardRoutes)
app.use('/api/project',projectRoutes)
app.use('/api/comment',commentRoutes)





app.use(express.static(path.join(__dirname, "../client/build")));


app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.resolve(__dirname, "../client/build", "index.html"));
});


app.use(errorHandler);
export default app;
