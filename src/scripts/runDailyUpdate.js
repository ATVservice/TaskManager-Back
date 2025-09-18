// runDaily.js - פשוט ומהיר
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { refreshTodayTasks, updateDaysOpen } from '../controllers/todayTasksController.js';

dotenv.config();

export async function runDailyUpdate() {
  try {
    console.log('Running daily task sync...');
    
    const URI = process.env.LOCAL_URI;
    await mongoose.connect(URI);
    console.log('Connected to MongoDB 😍');
    
    await refreshTodayTasks();
    await updateDaysOpen();
    
    console.log('✅ Done!');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
  }
}
