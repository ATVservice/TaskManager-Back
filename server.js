import http from "http";
import app from './src/app.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cron from "node-cron";
import { runDailyUpdate } from './src/scripts/runDailyUpdate.js';
import { generateAlerts } from './src/scripts/generateAlerts.js';
import { generateWeeklyDrawerSummary } from './src/scripts/generateWeeklyDrawerSummary.js';

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { populateDelayedTasks } from './src/controllers/overdueTasksController.js';

dayjs.extend(utc);
dayjs.extend(timezone);

dotenv.config();
const URI = process.env.LOCAL_URI;

mongoose.connect(URI)
  .then(async () => {
    console.log('Connected to MongoDB 😍');
    // await populateDelayedTasks();
    // mongoose.disconnect();
    
    
    cron.schedule("55 3 * * *", async () => {
      console.log("🚀 Cron triggered at", new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }));
      try {
        await runDailyUpdate();
        console.log('✅ Scheduled daily update completed');
      } catch (error) {
        console.error('❌ Scheduled daily update failed:', error);
      }
    }, { timezone: "Asia/Jerusalem" });

    cron.schedule("58 3 * * 0", async () => {
      generateWeeklyDrawerSummary();
    }, { timezone: "Asia/Jerusalem" });

    cron.schedule("0 4 * * *", () => {
      generateAlerts();
    }, { timezone: "Asia/Jerusalem" });

    const PORT = process.env.PORT || 5000;
    const server = http.createServer(app);

    // הגדרות לשמירת חיבור פתוח בין בקשות

    server.keepAliveTimeout = 61 * 1000; // זמן חיבור פתוח
    server.headersTimeout = 65 * 1000;   // סף סגירה אוטומטית של חיבור

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => console.log({ error: err.message }));
