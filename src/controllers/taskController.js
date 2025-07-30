import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';
import User from '../models/User.js';
import getNextTaskId from '../utils/getNextTaskId.js';
import mongoose, { now } from 'mongoose';
import dayjs from 'dayjs';
import TodayTask from '../models/TodayTask.js';


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
            organization,
            project,
            isRecurring,
            frequencyType,
            frequencyDetails
        } = req.body.form;
        console.log("req.body.form", req.body.form);

        const creatorId = req.user._id;

        if (!Array.isArray(assignees) || assignees.length === 0) {
            return res.status(400).json({ error: 'שדה assignees חסר או לא תקין' });
        }

        // שליפת המשתמשים לפי userName
        const users = await User.find({ _id: { $in: assignees } });
        if (users.length !== assignees.length) {
            return res.status(400).json({ error: 'יש אחראים שלא קיימים במערכת' });
        }

        // מיפוי ל־_id
        const assigneeIds = users.map(user => user._id);

        // שליפת האחראי הראשי לפי userName
        const mainAssigneeUser = users.find(user => user._id.toString() === mainAssignee);
        if (!mainAssigneeUser) {
            return res.status(400).json({ error: 'האחראי הראשי חייב להיות מתוך רשימת האחראים' });
        }
        if (importance !== 'מיידי') {

            if (!subImportance || subImportance === '') {
                delete req.body.form.subImportance;
            }
        }
        else {
            if (!subImportance || subImportance === '') {
                res.status(400)
                throw new Error('שדה subImportance חובה עבור משימות מיידיות');
            }
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
            assignees: assigneeIds,
            mainAssignee: mainAssigneeUser._id,
            organization: new mongoose.Types.ObjectId(organization),
            project,
        };

        if (importance === 'מיידי' && subImportance && subImportance !== '') {
            baseTaskData.subImportance = subImportance;
        }

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

  
export const getTasks = async (req, res) => {

    const userId = req.user._id;
    const isAdmin = req.user.role === 'מנהל';
    console.log("userId", userId);
    console.log("isAdmin", isAdmin);

    const today = dayjs().startOf('day').toDate();

    let baseFilter = {
      isDeleted: false,
      dueDate: { $gt: today }  // משימות עתידיות בלבד
    };
  
    if (!isAdmin) {
      baseFilter.$or = [
        { mainAssignee: userId },
        { assignees: userId },
        { creator: userId } 
      ];
    }

    const tasks = await Task.find(baseFilter)
        // .select('_id taskId title organization mainAssignee status')
        .populate('mainAssignee', 'userName')
        .populate('organization', 'name')

    res.status(200).json(tasks);


};


export const getMoreDetails = async (req, res) => {
    const userId = req.user._id;
    const isAdmin = req.user.role === 'מנהל';
    const { _id } = req.params;

    // חיפוש קודם כל ב-Task
    let task = await Task.findOne({ _id })
      .select('assignees importance subImportance creator dueDate finalDeadline daysOpen createdAt project details mainAssignee')
      .populate('assignees', 'userName')
      .populate('creator', 'userName')
      .populate('mainAssignee', 'userName');

    // אם לא נמצא, חפש ב-RecurringTask
    if (!task) {
      task = await RecurringTask.findOne({ _id })
        .select('assignees importance subImportance creator daysOpen createdAt project details mainAssignee frequencyType frequencyDetails')
        .populate('assignees', 'userName')
        .populate('creator', 'userName')
        .populate('mainAssignee', 'userName');
    }

    if (!task) {
        res.status(404);
        throw new Error('משימה לא נמצאה');
    }

    const userIdStr = userId.toString();
    const creatorId = task.creator?._id?.toString();
    const mainAssigneeId = task.mainAssignee?._id?.toString?.() || task.mainAssignee?.toString?.();
    const assigneeIds = (task.assignees || []).map(a => a._id?.toString());

    if (!isAdmin) {
      const isAuthorized =
        creatorId === userIdStr ||
        mainAssigneeId === userIdStr ||
        assigneeIds.includes(userIdStr);

      if (!isAuthorized) {
        res.status(403);
        throw new Error('אין לך הרשאה לצפות בפרטי משימה זו')
      }
    }

    res.status(200).json(task);

};

export const duplicateTask = async (req, res) => {
      const { taskId } = req.body;
  
      if (!taskId) {
        res.status(400);
        throw new Error('לשכפול taskId יש לספק');
      }
  
      const originalTask = await Task.findOne({ taskId: taskId }).lean();
  
      if (!originalTask) {
        res.status(404);
        throw new Error('המשימה לשכפול לא נמצאה');
      }
  
      // יצירת מזהה חדש למשימה
      const newTaskId = await getNextTaskId();
  
      const duplicatedTaskData = {
        ...originalTask,
        _id: undefined, 
        taskId: newTaskId,
        createdAt: undefined,
        updatedAt: undefined,
      };
  
      const duplicatedTask = new Task(duplicatedTaskData);
      await duplicatedTask.save();
  
      return res.status(201).json({ message: 'המשימה שוכפלה בהצלחה', newTask: duplicatedTask });
  
    
  };
  


