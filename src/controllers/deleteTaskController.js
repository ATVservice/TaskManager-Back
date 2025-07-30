import LogDelete from "../models/LogDelete.js";
import RecurringTask from "../models/RecurringTask.js";
import Task from "../models/Task.js";
import TodayTask from "../models/TodayTask.js";
import User from "../models/User.js";
import bcrypt from "bcrypt";

export const validatePassword = async (userId, password) => {
    if (!password) return false;
    const user = await User.findById(userId).select('+password');
    if (!user || !user.password) return false;
    return bcrypt.compare(password, user.password);

}

const handleSoftDelete = async ({ entity, entityType, userId, isAdmin, isCreator, isAssignee, res }) => {
    if (isAdmin || isCreator) {
        entity.isDeleted = true;
        entity.deletedAt = new Date();
        entity.deletedBy = userId;

        await LogDelete.create({
            taskId: entity.taskId,
            taskRef: entity._id,
            action: 'מחיקה',
            user: userId,
        });

        entity.updatesHistory.push({
            date: new Date(),
            user: userId,
            status: entity.status,
            note: `מחיקה רכה (${entityType})`
        });

        await entity.save();
        return res.json({ message: `המשימה נמחקה (${entityType})` });
    }

    if (isAssignee) {
        if (!entity.hiddenFrom.includes(userId)) {
            entity.hiddenFrom.push(userId);
        }

        entity.updatesHistory.push({
            date: new Date(),
            user: userId,
            status: entity.status,
            note: `המשימה הוסתרה מהתצוגה שלך בלבד (${entityType})`
        });

        await entity.save();
        return res.json({ message: `המשימה הוסתרה מהתצוגה שלך בלבד (${entityType})` });
    }

    res.status(403);
    throw new Error('אין לך הרשאה למחוק משימה זו.');
};

export const softDeleteTask = async (req, res) => {
    const taskId = req.params.taskId;
    const userId = req.user.id;
    const userRole = req.user.role;
    const password = req.body.password;

    const isValidPassword = await validatePassword(userId, password);
    if (!isValidPassword) {
        res.status(401);
        throw new Error('סיסמה שגויה');
    }

    const isAdmin = userRole === 'מנהל';

    // נסה למצוא ב־Task
    let entity = await Task.findById(taskId);
    if (entity) {
        const isCreator = entity.creator?.toString() === userId;
        const isAssignee = entity.assignees?.some(u => u.toString() === userId);
        return await handleSoftDelete({ entity, entityType: 'Task', userId, isAdmin, isCreator, isAssignee, res });
    }

    // נסה למצוא ב־TodayTasks
    entity = await TodayTask.findById(taskId);
    if (entity) {
        if (entity.isRecurringInstance) {
            return res.status(400).json({ message: 'לא ניתן למחוק משימה קבועה' });
        }
        const isCreator = entity.creator?.toString() === userId;
        const isAssignee = entity.assignees?.some(u => u.toString() === userId);
        return await handleSoftDelete({ entity, entityType: 'TodayTask', userId, isAdmin, isCreator, isAssignee, res });
    }

    // נסה למצוא ב־RecurringTask
    entity = await RecurringTask.findById(taskId);
    if (entity) {
        const isCreator = entity.creator?.toString() === userId;
        const isAssignee = entity.assignees?.some(u => u.toString() === userId);
        return await handleSoftDelete({ entity, entityType: 'RecurringTask', userId, isAdmin, isCreator, isAssignee, res });
    }

    // לא נמצאה משימה
    res.status(404);
    throw new Error('משימה לא נמצאה');
};