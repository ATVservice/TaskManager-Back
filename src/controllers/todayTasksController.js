import TodayTask from '../models/TodayTask.js';
import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import utc from 'dayjs/plugin/utc.js';
dayjs.extend(utc);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);

export const refreshTodayTasks = async () => {
  const today = dayjs().startOf('day').toDate();
  const endOfToday = dayjs().endOf('day').toDate();

  // 1. ריקון טבלה
  await TodayTask.deleteMany({});

  // 2. משימות חד-פעמיות לתאריך היום
  const singleTasks = await Task.find({
    dueDate: { $gte: today, $lte: endOfToday },
    isDeleted: false
  }).lean();

  const recurringTasks = await RecurringTask.find({ isDeleted: false }).lean();

  const todayRecurring = recurringTasks.filter(task => {
    const now = dayjs();

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
  });

  // 3. שילוב למשימות להיום
  const sanitizeTask = (task, isRecurring) => ({
    ...task,
    sourceTaskId: task._id,
    isRecurringInstance: isRecurring,
    project: task.project && task.project !== "" ? task.project : null,
    taskModel: isRecurring ? 'RecurringTask' : 'Task',
  });

  const allToday = [
    ...singleTasks.map(task => sanitizeTask(task, false)),
    ...todayRecurring.map(task => sanitizeTask(task, true))
  ];

  await TodayTask.insertMany(allToday);
};

export const getTodayTasks = async (req, res) => {
  try {
    const userIdStr = String(req.user._id);
    const isAdmin = req.user.role === 'מנהל';
    const { isRecurringInstance } = req.query;

    const filter = {};
    if (!isAdmin) {
      filter.$or = [
        { mainAssignee: req.user._id },
        { assignees: req.user._id },
        { creator: req.user._id },
      ];
    }
    if (isRecurringInstance === 'true') filter.isRecurringInstance = true;
    else if (isRecurringInstance === 'false') filter.isRecurringInstance = false;

    console.log('Filter used:', filter);

    const tasks = await TodayTask.find(filter)
      .populate('assignees', 'userName')
      .populate('mainAssignee', 'userName')
      .populate('organization', 'name')
      .populate('creator', 'userName')
      .populate('project', 'name');

    console.log('Tasks found:', tasks.length);

    const today = dayjs().startOf('day');

    const updated = await Promise.all(
      tasks.map(async (doc) => {
        const task = doc.toObject();
        console.log('Processing task:', task._id, task.taskModel);

        // --- מקרה 1: משימה קבועה ---
        if (task.taskModel === 'RecurringTask' && task.sourceTaskId) {
          const recurring = await RecurringTask
            .findById(task.sourceTaskId)
            .select('notes');

          const notes = Array.isArray(recurring?.notes) ? recurring.notes : [];

          // מסננים רק הערות של היום על ידי המשתמש הנוכחי

          const today = dayjs().utc(); // או dayjs().startOf('day') אם רוצים להתחיל מהיום המקומי
          const userNotesToday = notes.filter(n => {
            const noteDate = dayjs(n.date).utc(); // ממיר ל-UTC
            const isToday = noteDate.year() === today.year() &&
              noteDate.month() === today.month() &&
              noteDate.date() === today.date();
            const isUser = n.user && String(n.user) === userIdStr;
            return isToday && isUser;
          });

          if (userNotesToday.length > 0) {
            // מחזירים את הסטטוס של ההערה האחרונה היום
            const last = userNotesToday.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
            task.status = last.status;
          } else {
            task.status = "לביצוע";
          }
        }

        // --- מקרה 2: משימה רגילה ---
        if (task.taskModel === 'Task' && task.sourceTaskId) {
          const tad = await TaskAssigneeDetails.findOne({
            taskId: task.sourceTaskId,
            taskModel: 'Task',
            user: req.user._id,
          });

          if (tad) {
            const noteDate = dayjs(tad.updatedAt).startOf('day');
            const isToday = noteDate.isSame(today);

            // אם יש עדכון היום בלבד – משתמשים בו, אחרת "לביצוע"
            task.status = isToday ? tad.status : "לביצוע";
            task.statusNote = isToday ? tad.statusNote || '' : '';
          } else {
            const originalTask = await Task.findById(task.sourceTaskId).select('status statusNote');
            task.status = originalTask ? originalTask.status : "לביצוע";
            task.statusNote = originalTask ? originalTask.statusNote || '' : '';
          }
        }

        return task;
      })
    );

    console.log('Updated tasks count:', updated.length);
    res.status(200).json(updated);

  } catch (err) {
    console.error('getTodayTasks error:', err);
    res.status(500).json({ error: 'שגיאה בשליפת משימות להיום' });
  }
};

// export const getTodayTasks = async (req, res) => {
//   try {
//     const userIdStr = String(req.user._id);
//     const isAdmin = req.user.role === 'מנהל';
//     const { isRecurringInstance } = req.query;

//     const filter = {};
//     if (!isAdmin) {
//       filter.$or = [
//         { mainAssignee: req.user._id },
//         { assignees: req.user._id },
//         { creator: req.user._id },
//       ];
//     }
//     if (isRecurringInstance === 'true') filter.isRecurringInstance = true;
//     else if (isRecurringInstance === 'false') filter.isRecurringInstance = false;

//     const tasks = await TodayTask.find(filter)
//       .populate('assignees', 'userName')
//       .populate('mainAssignee', 'userName')
//       .populate('organization', 'name')
//       .populate('creator', 'userName')
//       .populate('project', 'name');

//     const updated = await Promise.all(
//       tasks.map(async (doc) => {
//         const task = doc.toObject();

//         // --- מקרה 1: משימה קבועה ---
//         if (task.taskModel === 'RecurringTask' && task.sourceTaskId) {
//           const recurring = await RecurringTask
//             .findById(task.sourceTaskId)
//             .select('notes');

//           const notes = Array.isArray(recurring?.notes) ? recurring.notes : [];

//           // סינון לפי המשתמש + רק תאריך של היום
//           const userNotesToday = notes.filter(n =>
//             n.user && String(n.user) === userIdStr &&
//             dayjs(n.date).isSame(dayjs(), 'day')
//           );

//           if (userNotesToday.length > 0) {
//             // לוקחים את האחרון לפי שעה
//             const last = userNotesToday.sort(
//               (a, b) => new Date(b.date) - new Date(a.date)
//             )[0];
//             task.status = last.status;
//           } else {
//             // אם אין עדכון להיום → תמיד "לביצוע"
//             task.status = "לביצוע";
//           }
//         }

//         // --- מקרה 2: משימה רגילה ---
//         if (task.taskModel === 'Task' && task.sourceTaskId) {
//           // בדיקה ב־TaskAssigneeDetails
//           const tad = await TaskAssigneeDetails.findOne({
//             taskId: task.sourceTaskId,
//             taskModel: 'Task',
//             user: req.user._id,
//           });

//           if (tad) {
//             task.status = tad.status;
//             task.statusNote = tad.statusNote || '';
//           } else {
//             // fallback: מתוך Task המקורי
//             const originalTask = await Task.findById(task.sourceTaskId).select('status statusNote');
//             if (originalTask) {
//               task.status = originalTask.status;
//               task.statusNote = originalTask.statusNote || '';
//             }
//           }
//         }

//         return task;
//       })
//     );

//     res.status(200).json(updated);
//   } catch (err) {
//     console.error('getTodayTasks error:', err);
//     res.status(500).json({ error: 'שגיאה בשליפת משימות להיום' });
//   }
// };

// חישוב שדה daysOpen
export const updateDaysOpen = async () => {
  try {
    const today = dayjs().startOf('day');

    // בוחר רק משימות שלא הושלמו ולא בוטלו
    const tasks = await Task.find();

    const bulkOps = tasks.map(task => {
      const created = dayjs(task.createdAt);
      const daysOpen = today.diff(created, 'day'); // חישוב מספר הימים
      return {
        updateOne: {
          filter: { _id: task._id },
          update: { $set: { daysOpen } },
        },
      };
    });

    if (bulkOps.length > 0) {
      await Task.bulkWrite(bulkOps);
      console.log(`✅ עדכון daysOpen ל-${bulkOps.length} משימות`);
    } else {
      console.log('אין משימות לעדכן');
    }
  } catch (err) {
    console.error('שגיאה בעדכון daysOpen:', err);
  }
}


