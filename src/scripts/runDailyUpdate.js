import { refreshTodayTasks, updateDaysOpen } from '../controllers/todayTasksController.js';

export default async function runDailyUpdate() {
  console.log('Running daily task sync...');
  await refreshTodayTasks();
  await updateDaysOpen();
  console.log('✅ Done!');
}
