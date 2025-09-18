// runDaily.js - פשוט ומהיר
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { refreshTodayTasks, updateDaysOpen } from './src/controllers/todayTasksController.js';

dotenv.config();

async function run() {
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
    process.exit(0);
  }
}

run();