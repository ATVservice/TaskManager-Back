import { refreshTodayTasks, updateDaysOpen } from '../controllers/todayTasksController.js';

export async function runDailyUpdate() {
  try {
    console.log('Running daily task sync...');
    await refreshTodayTasks();
    await updateDaysOpen();
    console.log('✅ Done!');
  } catch (error) {
    console.error('Error:', error);
  }
}
