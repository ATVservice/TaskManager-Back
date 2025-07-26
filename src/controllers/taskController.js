import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';
import User from '../models/User.js';
import getNextTaskId from '../utils/getNextTaskId.js';

export const createTask = async (req, res) => {
  try {
    const {
      title,
      details,
      dueDate,
      finalDeadline,
      importance,
      subImportance,
      assignees,
      mainAssignee,
      organizations,
      project,
      isRecurring,
      frequencyType,
      frequencyDetails
    } = req.body;

    const creatorId = req.user._id;

    // בדיקה: כל המשתמשים שב-assignees קיימים
    const users = await User.find({ _id: { $in: assignees } });
    if (users.length !== assignees.length) {
      return res.status(400).json({ error: 'יש אחראים לא קיימים במערכת' });
    }

    // בדיקה: האחראי הראשי קיים גם בתוך הרשימה
    if (!assignees.includes(mainAssignee)) {
      return res.status(400).json({ error: 'האחראי הראשי חייב להיות מתוך רשימת האחראים' });
    }

    const taskId = await getNextTaskId();

    const baseTaskData = {
      taskId,
      creator: creatorId,
      title,
      details,
      dueDate,
      finalDeadline,
      importance,
      subImportance,
      assignees,
      mainAssignee,
      organization: organizations,
      project,
    };

    if (isRecurring) {
      const recurringTask = new RecurringTask({
        ...baseTaskData,
        frequencyType,
        frequencyDetails,
      });
      await recurringTask.save();
    } else {
      const task = new Task(baseTaskData);
      await task.save();
    }

    return res.status(201).json({ message: 'משימה נוצרה בהצלחה' });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'שגיאה ביצירת משימה' });
  }
};
