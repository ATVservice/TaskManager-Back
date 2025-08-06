import Alert from '../models/Alert.js';
import Task from '../models/Task.js';
import User from '../models/User.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js'
import mongoose from 'mongoose';

export const generateAlerts = async () => {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 1. התראות למשתמשים
    //מגירה לא עודכנה 14 יום
    const staleDrawerTasks = await Task.find({
        status: 'מגירה',
        updatedAt: { $lt: fourteenDaysAgo },
    });

    for (const task of staleDrawerTasks) {
        const creatorId = task.creator;
        await createAlertIfNotExists('מגירה לא עודכנה 14 ימים', task._id, creatorId);
    }

    // ●	אם תאריך היעד עבר, והמשימה עדיין לא סומנה כהושלמה (מלבד משימות שבוטלה).

    const overdueTasks = await Task.find({
        finalDeadline: { $lt: now },
        status: { $nin: ['בוטלה', 'הושלמה'] },
        isDeleted: false,
    });
    for (const task of overdueTasks) {
        for (const userId of task.assignees) {
          const detail = await TaskAssigneeDetails.findOne({
            task: task._id,
            user: userId,
          });
    
          if (!detail || detail.status !== 'הושלם') {
            await createAlertIfNotExists('עבר המועד', task._id, userId);
          }
        }
      }

    // 2. התראות לאחראי ראשי
    for (const task of overdueTasks) {
        const notCompletedAssignees = await TaskAssigneeDetails.find({
            taskId: task._id,
            taskModel: 'Task',
            user: { $in: task.assignees },
            status: { $ne: 'הושלם' },
        });

        if (notCompletedAssignees.length > 0 && task.mainAssignee) {
            await createAlertIfNotExists(
                'לא עודכן ע"י אחד האחראים',
                task._id,
                task.mainAssignee
            );
        }

        if (
            task.status === 'מגירה' &&
            task.updatedAt < fourteenDaysAgo &&
            task.mainAssignee
        ) {
            await createAlertIfNotExists(
                'משימה לא עודכנה 14 ימים',
                task._id,
                task.mainAssignee
            );
        }
    }

    // 3. למנהל המערכת
    const adminUsers = await User.find({ role: 'מנהל' });

    const longUncompletedOnceTasks = await Task.find({
        isRecurringInstance: false,
        status: { $ne: 'הושלמה' },
        createdAt: { $lt: thirtyDaysAgo },
    });

    for (const task of longUncompletedOnceTasks) {
        for (const admin of adminUsers) {
            await createAlertIfNotExists('משימה חד"פ לא הושלמה 30 ימים' , task._id, admin._id);
        }
    }

    const allStaleDrawers = await Task.find({
        status: 'מגירה',
        updatedAt: { $lt: fourteenDaysAgo },
    });

    for (const task of allStaleDrawers) {
        for (const admin of adminUsers) {
            await createAlertIfNotExists('מגירה לא עודכנה 14 ימים', task._id, admin._id);
        }
    }
};

const createAlertIfNotExists = async (type, taskId, userId) => {
    const exists = await Alert.exists({ type, task: taskId, recipient: userId });
    if (!exists) {
        await Alert.create({
            type,
            task: taskId,
            recipient: userId,
            createdAt: new Date(),
            resolved: false,
        });
    }
};
