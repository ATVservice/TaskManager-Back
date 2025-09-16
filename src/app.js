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
import cors from 'cors';
import errorHandler from './middleware/errorMiddleware.js';
import dotenv from 'dotenv';
dotenv.config();

const app = express();

const allowedOrigins = [
  process.env.FRONT_PORT?.trim(),
  'http://localhost:3000',
  'https://taskmanager-front-production.up.railway.app' 
];

console.log("בדיקת שרת - FRONT_PORT:", process.env.FRONT_PORT);
console.log("Allowed origins:", allowedOrigins);

app.use(cors({
  origin: function(origin, callback){
    console.log("Request origin:", origin); 
    if(!origin) return callback(null, true);
    if(allowedOrigins.indexOf(origin) !== -1){
      return callback(null, true);
    }
    const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
    return callback(new Error(msg), false);
  },
  credentials: true
}));
  
app.use(express.json());

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








app.use(errorHandler);
export default app;
