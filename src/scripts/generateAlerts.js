import mongoose from 'mongoose';
import { generateAlerts } from '../controllers/alertController.js';
import dotenv from 'dotenv';

dotenv.config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  console.log('Generating alerts...');
  await generateAlerts();
  console.log('✅ Alerts done');
  process.exit();
});
