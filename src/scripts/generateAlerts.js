import { generateAlerts as generateAlertsController } from '../controllers/alertController.js';

// פעם ביום
export async function generateAlerts() {
  console.log('Generating alerts...');
  await generateAlertsController();
  console.log('✅ Alerts done');
}
