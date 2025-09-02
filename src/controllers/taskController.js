import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';
import User from '../models/User.js';
import getNextTaskId from '../utils/getNextTaskId.js';
import mongoose, { now } from 'mongoose';
import dayjs from 'dayjs';
import TodayTask from '../models/TodayTask.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';


export const createTask = async (req, res) => {
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

    if (importance !== 'מגירה') {
      if (!dueDate || !finalDeadline) {
        res.status(400);
        throw new Error('חובה להגדיר תאריכים למשימות שאינן מגירה');
      }
    }
    

    const creatorId = req.user._id;

    if (!Array.isArray(assignees) || assignees.length === 0) {
      res.status(400);
      throw new Error('שדה assignees חסר או לא תקין')
    }

    // שליפת המשתמשים לפי userName
    const users = await User.find({ _id: { $in: assignees } });
    if (users.length !== assignees.length) {
      res.status(400);
      throw new Error('יש אחראים שלא קיימים במערכת')
    }

    // מיפוי ל־_id
    const assigneeIds = users.map(user => user._id);

    // שליפת האחראי הראשי לפי userName
    const mainAssigneeUser = users.find(user => user._id.toString() === mainAssignee);
    if (!mainAssigneeUser) {
      res.status(400);
      throw new Error('האחראי הראשי חייב להיות מתוך רשימת האחראים')
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


};


export const getTasks = async (req, res) => {
  const userId = req.user._id;
  const isAdmin = req.user.role === 'מנהל';

  const today = dayjs().startOf('day').toDate();

  let baseFilter = {
    isDeleted: false,
    dueDate: { $gt: today },
    $expr: {
      $not: {
        $in: [userId, { $ifNull: ["$hiddenFrom", []] }]
      }
    }
  };

  if (!isAdmin) {
    baseFilter.$or = [
      { mainAssignee: userId },
      { assignees: userId },
      { creator: userId }
    ];
  }

  const tasks = await Task.find(baseFilter)
    .populate('mainAssignee', 'userName')
    .populate('organization', 'name')
    .populate('project', 'name');


  const userPersonalDetails = await TaskAssigneeDetails.find({
    user: userId,
    taskModel: 'Task'
  });
  console.log(userPersonalDetails)

  const detailsMap = new Map();

  userPersonalDetails.forEach(detail => {
    const key = String(detail.taskId);
    detailsMap.set(key, detail);
  });

  const tasksWithPersonal = tasks.map(task => {
    const personal = detailsMap.get(String(task._id));
    console.log("task._id:", task._id.toString());
    console.log("detailsMap keys:", [...detailsMap.keys()]);

    return {
      ...task.toObject(),
      personalDetails: personal ? {
        status: personal.status,
        updateText: personal.updateText,
        completed: personal.completed,
      } : null
    };
  });


  res.status(200).json(tasksWithPersonal);
};


export const getMoreDetails = async (req, res) => {
  const userId = req.user._id;
  const isAdmin = req.user.role === 'מנהל';
  const { _id } = req.params;

  // חיפוש קודם כל ב-Task
  let task = await Task.findOne({ _id })
    .select('assignees importance subImportance creator dueDate finalDeadline daysOpen createdAt project details mainAssignee statusNote')
    .populate('assignees', 'userName')
    .populate('creator', 'userName')
    .populate('mainAssignee', 'userName')
    .populate('project', 'name');


  // אם לא נמצא, חפש ב-RecurringTask
  if (!task) {
    task = await RecurringTask.findOne({ _id })
      .select('assignees importance subImportance creator daysOpen createdAt project details mainAssignee frequencyType frequencyDetails ')
      .populate('assignees', 'userName')
      .populate('creator', 'userName')
      .populate('mainAssignee', 'userName')
      .populate('project', 'name');
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

  const originalTask = await Task.findOne({ _id: taskId }).lean();


  if (!originalTask) {
    res.status(400);
    throw new Error('לא ניתן לשכפל משימה קבועה');
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



