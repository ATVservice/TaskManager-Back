import { generateWeeklyDrawerSummary as generateWeeklyDrawerSummaryController } from '../controllers/alertController.js';

// פעם בשבוע
export async function generateWeeklyDrawerSummary() {
  console.log('Generating weekly drawer summary...');
  await generateWeeklyDrawerSummaryController();
  console.log('✅ Weekly drawer summary done');
}
