import Task from '../models/Task.js';
import TodayTask from '../models/TodayTask.js';
import RecurringTask from '../models/RecurringTask.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import mongoose from 'mongoose';
import dayjs from 'dayjs';

export const getUserPerformance = async (req, res) => {
  try {
    const userId = req.user._id;
    const { rangeType, from, to, groupBy = 'day' } = req.query;

    let startDate, endDate;

if (from && to) {
    startDate = dayjs(from).startOf('day').toDate();
    endDate = dayjs(to).endOf('day').toDate();
  } else {
    switch(rangeType) {
      case 'week':
        startDate = dayjs().startOf('week').toDate();
        endDate = dayjs().endOf('week').toDate();
        break;
      case 'month':
        startDate = dayjs().startOf('month').toDate();
        endDate = dayjs().endOf('month').toDate();
        break;
      case 'year':
        startDate = dayjs().startOf('year').toDate();
        endDate = dayjs().endOf('year').toDate();
        break;
      case 'day':
      default:
        startDate = dayjs().startOf('day').toDate();
        endDate = dayjs().endOf('day').toDate();
    }
  }
  



    // פונקציית עזר
    const fetchTasksForUser = async (Model) => {
      const tasks = await Model.find({
        assignees: userId,
        updatedAt: { $gte: startDate, $lte: endDate }, // שינוי: טווח לפי מועד עדכון
        isDeleted: { $ne: true }
      }).lean();

      const taskIds = tasks.map(t => t._id);
      const personalStatuses = await TaskAssigneeDetails.find({
        taskId: { $in: taskIds },
        user: userId
      }).lean();

      return tasks.map(task => {
        const personal = personalStatuses.find(p => String(p.taskId) === String(task._id));
        return {
          ...task,
          finalStatus: personal?.status || task.status
        };
      });
    };

    // משיכת כל סוגי המשימות
    const [normalTasks, todayTasks, recurringTasks] = await Promise.all([
      fetchTasksForUser(Task),
      fetchTasksForUser(TodayTask),
      fetchTasksForUser(RecurringTask)
    ]);

    const allTasks = [...normalTasks, ...todayTasks, ...recurringTasks];



    // פילוח לפי חשיבות - רק משימות שהושלמו
    const byImportance = allTasks.reduce((acc, task) => {
      acc[task.importance] = (acc[task.importance] || 0) + 1;
      return acc;
    }, {});

        // ספירה של משימות שהושלמו
        const completedTasks = allTasks.filter(t => t.finalStatus === 'הושלם');
        const completedCount = completedTasks.length;
    

    // גרף התקדמות יומי וחודשי לפי updatedAt
    const groupFormat = groupBy === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';

    const dailyProgress = completedTasks.reduce((acc, task) => {
      const day = dayjs(task.updatedAt).format(groupFormat);
      if (!acc[day]) acc[day] = { date: day, completed: 0 };
      acc[day].completed++;
      return acc;
    }, {});
    

    res.json({
      completedCount,
      byImportance,
      dailyProgress: Object.values(dailyProgress)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// import Task from '../models/Task.js';
// import TodayTask from '../models/TodayTask.js';
// import RecurringTask from '../models/RecurringTask.js';
// import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
// import mongoose from 'mongoose';
// import dayjs from 'dayjs';

// export const getUserPerformance = async (req, res) => {
//   try {
//     const userId = req.user._id;

//     // קביעת טווח ברירת מחדל – היום הנוכחי
//     const { from, to } = req.query;
//     const startDate = from ? dayjs(from).startOf('day').toDate() : dayjs().startOf('day').toDate();
//     const endDate = to ? dayjs(to).endOf('day').toDate() : dayjs().endOf('day').toDate();

//     // פונקציית עזר: מביאה משימות למשתמש מסוים ומודלים שונים
//     const fetchTasksForUser = async (Model, dateField) => {
//       const tasks = await Model.find({
//         assignees: userId,
//         [dateField]: { $gte: startDate, $lte: endDate },
//         isDeleted: { $ne: true }
//       }).lean();

//       // עדכון סטטוס לפי TaskAssigneeDetails אם קיים
//       const taskIds = tasks.map(t => t._id);
//       const personalStatuses = await TaskAssigneeDetails.find({
//         taskId: { $in: taskIds },
//         user: userId
//       }).lean();

//       return tasks.map(task => {
//         const personal = personalStatuses.find(p => String(p.taskId) === String(task._id));
//         return {
//           ...task,
//           finalStatus: personal?.status || task.status
//         };
//       });
//     };

//     // משיכת כל סוגי המשימות
//     const [normalTasks, todayTasks, recurringTasks] = await Promise.all([
//       fetchTasksForUser(Task, 'dueDate'),
//       fetchTasksForUser(TodayTask, 'dueDate'),
//       fetchTasksForUser(RecurringTask, 'nextRunDate')
//     ]);

//     const allTasks = [...normalTasks, ...todayTasks, ...recurringTasks];

//     // חישוב מספר משימות שהושלמו
//     const completedCount = allTasks.filter(t => t.finalStatus === 'הושלם').length;

//     // פילוח לפי סוג משימה
//     const byImportance = allTasks.reduce((acc, task) => {
//       acc[task.importance] = (acc[task.importance] || 0) + 1;
//       return acc;
//     }, {});

//     // גרף התקדמות יומי
//     const dailyProgress = allTasks.reduce((acc, task) => {
//       const day = dayjs(task.dueDate || task.nextRunDate).format('YYYY-MM-DD');
//       if (!acc[day]) acc[day] = { date: day, completed: 0 };
//       if (task.finalStatus === 'הושלם') acc[day].completed++;
//       return acc;
//     }, {});
    
//     res.json({
//       completedCount,
//       byImportance,
//       dailyProgress: Object.values(dailyProgress)
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Server error' });
//   }
// };
