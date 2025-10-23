import Task from '../models/Task.js';
import TodayTask from '../models/TodayTask.js';
import RecurringTask from '../models/RecurringTask.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
dayjs.extend(utc);
dayjs.extend(timezone);



async function applyUserStatus(tasks, userId) {
    return Promise.all(
        tasks.map(async (task) => {
            // אם מדובר במשימה שבוטלה - היא מנצחת תמיד
            if (task.status === "בוטלה") {
                return task;
            }

            const details = await TaskAssigneeDetails.findOne({
                taskId: task._id,
                user: userId,
            }).sort({ createdAt: -1 });

            if (details) {
                task = task.toObject(); // שיהיה ניתן לעדכן
                task.status = details.status;
                task.statusNote = details.statusNote || task.statusNote;
            }


            return task;
        })
    );
}

const getBaseFilter = (user) => {
    if (user.role === 'מנהל') {
        return { isDeleted: false };
    }

    return {
        isDeleted: false,
        hiddenFrom: { $ne: user._id },
        $or: [
            { mainAssignee: user._id },
            { assignees: user._id },
            { creator: user._id }

        ]
    };
};
// רקמ משימות שוטפות
// הושלמו
export const getCompletedTasks = async (req, res) => {
    try {
        const userId = req.user._id;
        const filter = {
            ...getBaseFilter(req.user),
        };

        let tasks = await Task.find(filter)
            .populate('mainAssignee', 'userName')
            .populate('assignees', 'userName')
            .populate('organization', 'name')
            .populate('project', 'name')
            .lean();



        tasks = await applyUserStatus(tasks, userId);

        tasks = tasks.filter(t => t.status === 'הושלם');

        res.json(tasks);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'שגיאה בשליפת משימות שהושלמו' });
    }
};
// בוטלו
export const getCancelledTasks = async (req, res) => {
    const filter = {
        ...getBaseFilter(req.user),
        status: 'בוטלה',
    };

    const singleTasks = await Task.find(filter)
        .populate('mainAssignee', 'userName')
        .populate('assignees', 'userName')
        .populate('organization', 'name')
        .populate('project', 'name')
        .lean();

    res.json(singleTasks);
};
// מגירה
export const getDrawerTasks = async (req, res) => {
    try {
        const userId = req.user._id;
        const filter = {
            ...getBaseFilter(req.user),
            status: { $ne: "בוטלה" },
        };

        let tasks = await Task.find(filter)
            .populate('mainAssignee', 'userName')
            .populate('assignees', 'userName')
            .populate('organization', 'name')
            .populate('project', 'name')
            .lean();

        tasks = await applyUserStatus(tasks, userId);

        tasks = tasks.filter(t => t.importance === 'מגירה');

        res.json(tasks);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'שגיאה בשליפת משימות מגירה' });
    }
};
export const getRecurringTasks = async (req, res) => {
    const userId = req.user._id;
    const isAdmin = req.user.role === 'מנהל';

    const filter = {
        ...getBaseFilter(req.user),
    };

    const tasks = await RecurringTask.find(filter)
        // .select('_id taskId title organization mainAssignee status')
        .populate('assignees', 'userName')
        .populate('mainAssignee', 'userName')
        .populate('organization', 'name')
        .populate('project', 'name')
        .lean();

    // .populate('creator', 'userName');


    res.status(200).json(tasks);
};
// משימות פתוחות מעוכבות
export const getOverdueTasks = async (req, res) => {
    try {
      const userId = req.user._id;
  
      // נגדיר את תחילת היום הנוכחי (00:00)
      const todayStart = dayjs().tz("Asia/Jerusalem").startOf('day').toDate();
  
      const baseFilter = getBaseFilter(req.user);
  
      const filter = {
        ...baseFilter,
        isRecurringInstance: false,
        status: { $nin: ['בוטלה', 'הושלם'] },
        $or: [
          { finalDeadline: { $lt: todayStart } },
          { dueDate: { $lt: todayStart } },
        ],
      };
  
      let tasks = await Task.find(filter)
        .populate('mainAssignee', 'userName')
        .populate('assignees', 'userName')
        .populate('organization', 'name')
        .populate('project', 'name')
        .lean();
  
      tasks = await applyUserStatus(tasks, userId);
  
      res.status(200).json(tasks);
    } catch (err) {
      console.error('שגיאה בשליפת משימות שעבר תאריך היעד:', err);
      res.status(500).json({ error: 'שגיאה בשליפת משימות שעבר תאריך היעד' });
    }
  };
  
  

