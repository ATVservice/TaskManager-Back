import app from './src/app.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cron from "node-cron";
import { runDailyUpdate } from './src/scripts/runDailyUpdate.js'
import { generateAlerts } from './src/scripts/generateAlerts.js';
import { generateWeeklyDrawerSummary } from './src/scripts/generateWeeklyDrawerSummary.js';

dotenv.config();

// 02:00 כל יום
cron.schedule("0 23 * * *", async () => {  
// cron.schedule("*/5 * * * *", async () => {
  try {
    await runDailyUpdate();
    console.log('✅ Scheduled daily update completed');
  } catch (error) {
    console.error('❌ Scheduled daily update failed:', error);
  }
});
// 02:30 כל יום ראשון
cron.schedule("30 23 * * 0", () => {
  generateWeeklyDrawerSummary();
});
// 03:00 כל יום
cron.schedule("0 0 * * *", () => {
  generateAlerts();
});


// התחברות למסד

const URI = process.env.LOCAL_URI
mongoose.connect(URI)
  .then(() => console.log('Connected to MongoDB 😍'))
  .catch(err => console.log({ error: err.message }));


// הפעלת השרת
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
