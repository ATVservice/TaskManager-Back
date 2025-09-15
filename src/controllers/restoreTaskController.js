import Task from '../models/Task.js';
import TodayTask from '../models/TodayTask.js';
import RecurringTask from '../models/RecurringTask.js';
import LogDelete from '../models/LogDelete.js';
import validatePassword from '../utils/validatePassword.js';

const getDeletedEntities = async (Model, userId, isAdmin) => {
    const query = isAdmin
        ? {
            $or: [
                { deletedBy: userId },
                { isDeleted: true }
            ]
        }
        : {
            $or: [
                { deletedBy: userId },
                { hiddenFrom: userId }
            ]
        };

    return Model.find(query)
        .populate('organization', 'name')      
        .populate('mainAssignee', 'userName');  
};


export const getAllDeletedTasks = async (req, res) => {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'מנהל';

    const [tasks, todayTasks, recurringTasks] = await Promise.all([
        getDeletedEntities(Task, userId, isAdmin),
        getDeletedEntities(TodayTask, userId, isAdmin),
        getDeletedEntities(RecurringTask, userId, isAdmin),
    ]);

    const all = [
        ...tasks.map(t => ({ ...t.toObject(), type: 'Task' })),
        ...todayTasks.map(t => ({ ...t.toObject(), type: 'TodayTask' })),
        ...recurringTasks.map(t => ({ ...t.toObject(), type: 'RecurringTask' })),
    ];

    res.json(all);
};



export const restoreTask = async (req, res) => {
    const taskId = req.params.taskId;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'מנהל';
    const password = req.body.password;

    const isValidPassword = await validatePassword(userId, password);
    if (!isValidPassword) {
        res.status(401);
        throw new Error('סיסמה שגויה');
    }

    const models = [
        { model: Task, type: 'Task' },
        { model: TodayTask, type: 'TodayTask' },
        { model: RecurringTask, type: 'RecurringTask' },
    ];

    for (const { model, type } of models) {
        const entity = await model.findById(taskId)

        if (!entity) continue;

        const isSoftDeleted = entity.isDeleted;
        const isHiddenFromUser = entity.hiddenFrom?.includes(userId);
        const deletedByUser = entity.deletedBy?.toString() === userId;

        const canRestore =
            (isAdmin && isSoftDeleted) ||
            (!isAdmin && (deletedByUser || isHiddenFromUser));

        if (!canRestore) {
            continue;
        }

        // ✅ שחזור
        if (isSoftDeleted) {
            entity.isDeleted = false;
            entity.deletedAt = undefined;
            entity.deletedBy = undefined;
        }

        if (isHiddenFromUser) {
            entity.hiddenFrom = entity.hiddenFrom.filter(id => id.toString() !== userId);
        }

        entity.updatesHistory.push({
            date: new Date(),
            user: userId,
            status: entity.status,
            note: `שחזור משימה (${type})`,
        });

        await entity.save();

        await LogDelete.create({
            taskId: entity.taskId,
            taskRef: entity._id,
            action: 'שחזור',
            user: userId,
        });

        return res.json({ message: "המשימה שוחזרה בהצלחה!" });
    }

    return res.status(403).json({ message: 'אין לך הרשאה לשחזר משימה זו או שהיא לא קיימת' });
};
