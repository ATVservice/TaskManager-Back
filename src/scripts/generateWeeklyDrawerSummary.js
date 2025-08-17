import mongoose from 'mongoose';
import { generateWeeklyDrawerSummary } from '../controllers/alertController.js';
import dotenv from 'dotenv';

dotenv.config();

// להריץ פעם בשבוע
mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Generating alerts...');
  await generateWeeklyDrawerSummary();
  console.log('✅ Alerts done');
  process.exit();
});
