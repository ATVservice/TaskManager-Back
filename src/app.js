import express from 'express';
import path from "path";
import compression from "compression";
import cors from 'cors';
import { fileURLToPath } from "url";
import dotenv from 'dotenv';

// כל הראוטים שלך
import associationRoutes from './routes/associationRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import deleteTaskRoutes from './routes/deleteTaskRoutes.js';
import updateTaskRoutes from './routes/updateTaskRoutes.js';
import updateTodayTask from "./routes/updateTodayTaskRoutes.js";
import restoreTaskRoutes from './routes/restoreTaskRoutes.js';
import taskFiltersRoutes from './routes/taskFiltersRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import adminDashboardRoutes from './routes/adminDashboardRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
import goalRoutes from './routes/goalRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import commentRoutes  from './routes/commentRoutes.js';
import overdueTasksRoutes from './routes/overdueTasksRoutes.js';
import errorHandler from './middleware/errorMiddleware.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(compression());

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

// כל ה-API Routes שלך
app.use('/api/associations', associationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/taskFilters', taskFiltersRoutes);
app.use('/api/delete', deleteTaskRoutes);
app.use('/api/restore', restoreTaskRoutes);
app.use('/api/update', updateTaskRoutes);
app.use('/api/updateToday', updateTodayTask);
app.use('/api/alert', alertRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/goal', goalRoutes);
app.use('/api/report', reportRoutes);
app.use('/api/adminDashboard', adminDashboardRoutes);
app.use('/api/project', projectRoutes);
app.use('/api/comment', commentRoutes);
app.use('/api/overdueTasks', overdueTasksRoutes);

app.use((req, res, next) => {
  const oldJson = res.json;
  res.json = function(data) {
    const size = JSON.stringify(data).length;
    const sizeKB = (size / 1024).toFixed(2);
    console.log(`📦 ${req.path} - ${sizeKB} KB`);
    if (size > 500000) {
      console.warn(`⚠️ תגובה גדולה! ${sizeKB} KB`);
    }
    return oldJson.call(this, data);
  };
  next();
});

// סטטיים (React)
app.use(express.static(path.join(__dirname, "build"), {
  maxAge: "1y",
  immutable: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  },
}));

// app.use(express.static("build", {
//   setHeaders: (res, filePath) => {
//     if (filePath.endsWith("index.html")) {
//       res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
//     } else {
//       res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
//     }
//   },
// }));

// כל מה שלא נתפס ב-API יגיע ל-React
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.resolve("build", "index.html"));
});

// טיפול בשגיאות
app.use(errorHandler);

export default app;
