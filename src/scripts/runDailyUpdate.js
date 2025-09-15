import mongoose from 'mongoose';
import { refreshTodayTasks, updateDaysOpen } from '../controllers/todayTasksController.js';
import dotenv from 'dotenv';

dotenv.config();
// להריץ פעם ביום
mongoose.connect(process.env.LOCAL_URI).then(async () => {
  console.log('Running daily task sync...');
  await refreshTodayTasks();
  await updateDaysOpen();
  console.log('✅ Done!');
  process.exit();
});
