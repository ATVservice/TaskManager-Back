import TodayTask from '../models/TodayTask.js';
import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';
import dayjs from 'dayjs';

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
        project: task.project && task.project !== "" ? task.project : undefined
      });
      
      const allToday = [
        ...singleTasks.map(task => sanitizeTask(task, false)),
        ...todayRecurring.map(task => sanitizeTask(task, true))
      ];

    await TodayTask.insertMany(allToday);
};

export const getTodayTasks = async (req, res) => {
    const userId = req.user._id;
    const isAdmin = req.user.role === 'מנהל';

    const { isRecurringInstance } = req.query;

    const filter = {};

    if (!isAdmin) {
        filter.$or = [
            { mainAssignee: userId },
            { assignees: userId },
            { creator: userId }
        ];
    }

    if (isRecurringInstance === 'true') {
        filter.isRecurringInstance = true;
    } else if (isRecurringInstance === 'false') {
        filter.isRecurringInstance = false;
    }

    const tasks = await TodayTask.find(filter)
        // .select('_id taskId title organization mainAssignee status')
        .populate('assignees', 'userName')
        .populate('mainAssignee', 'userName')
        .populate('organization', 'name')
        .populate('creator', 'userName');


    res.status(200).json(tasks);
};

// חישוב שדה daysOpen
export const updateDaysOpen = async() => {
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


