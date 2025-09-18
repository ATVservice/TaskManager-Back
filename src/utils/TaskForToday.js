import dayjs from "dayjs";
import TodayTask from "../models/TodayTask.js";

// פונקציה נפרדת לבדיקה אם משימה מתאימה להיום
export const isTaskForToday = (task, isRecurring = false) => {
    // שימוש בשעון ישראל
    const now = dayjs().tz('Asia/Jerusalem');
    const today = now.startOf('day').toDate();
    const endOfToday = now.endOf('day').toDate();
  
    if (!isRecurring) {
      // משימה רגילה - בודק אם התאריך יעד הוא היום
      return task.dueDate && task.dueDate >= today && task.dueDate <= endOfToday;
    } else {
      // משימה קבועה - בודק לפי סוג התדירות
      switch (task.frequencyType) {
        case 'יומי':
          return task.frequencyDetails?.includingFriday || now.day() !== 5;
        case 'יומי פרטני':
          return task.frequencyDetails?.days?.includes(now.day());
        case 'חודשי':
          return now.date() === task.frequencyDetails?.dayOfMonth;
        case 'שנתי':
          return now.date() === task.frequencyDetails?.day && now.month() + 1 === task.frequencyDetails?.month;
        default:
          return false;
      }
    }
  };
  
  // פונקציה להוספת משימה למשימות היום
  export const addTaskToToday = async (task, isRecurring = false) => {
    const sanitizeTask = (task, isRecurring) => ({
      ...task.toObject ? task.toObject() : task,
      sourceTaskId: task._id,
      isRecurringInstance: isRecurring,
      project: task.project && task.project !== "" ? task.project : null,
      taskModel: isRecurring ? 'RecurringTask' : 'Task',
    });
  
    const todayTask = new TodayTask(sanitizeTask(task, isRecurring));
    await todayTask.save();
  };

