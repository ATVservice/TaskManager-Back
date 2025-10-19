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



    // סט לעקוב אחרי משימות שכבר נוספו - מונע כפילויות מוחלטות
    const addedTaskIds = new Set();
    const uniqueTasks = [];

    // פונקציה לבדיקת אם משימה צריכה להיכלל
    const shouldIncludeTask = (task, type) => {
        const taskKey = `${type}_${task._id.toString()}`;
        
        // אם כבר נוסף - דלג
        if (addedTaskIds.has(taskKey)) {
            return false;
        }

        // בדוק אם המשימה באמת מוחקה או מוסתרת עבור המשתמש
        const isSoftDeleted = task.isDeleted === true;
        const isHiddenFromUser = task.hiddenFrom?.includes(userId);
        const deletedByUser = task.deletedBy?.toString() === userId;

        // למנהל - הצג הכל
        if (isAdmin) {
            return isSoftDeleted || isHiddenFromUser;
        }

        // למשתמש רגיל - הצג רק מה שהוא מחק או שהוסתר ממנו
        return (isSoftDeleted && deletedByUser) || isHiddenFromUser;
    };

    // 1. הוסף RecurringTasks מחוקות/מוסתרות
    recurringTasks.forEach(task => {
        if (shouldIncludeTask(task, 'RecurringTask')) {
            uniqueTasks.push({ ...task.toObject(), type: 'RecurringTask' });
            addedTaskIds.add(`RecurringTask_${task._id.toString()}`);
        }
    });

    // 2. הוסף Tasks רגילות מחוקות/מוסתרות
    tasks.forEach(task => {
        if (shouldIncludeTask(task, 'Task')) {
            uniqueTasks.push({ ...task.toObject(), type: 'Task' });
            addedTaskIds.add(`Task_${task._id.toString()}`);
        }
    });

    // 3. הוסף TodayTasks רק אם המשימה המקורית לא כבר בסל
    todayTasks.forEach(todayTask => {
        // בדוק אם המשימה המקורית כבר נוספה
        let skipDueToSource = false;
        
        if (todayTask.sourceTaskId && todayTask.taskModel) {
            const sourceKey = `${todayTask.taskModel}_${todayTask.sourceTaskId.toString()}`;
            
            if (addedTaskIds.has(sourceKey)) {
                skipDueToSource = true;
            }
        }

        if (!skipDueToSource && shouldIncludeTask(todayTask, 'TodayTask')) {
            uniqueTasks.push({ ...todayTask.toObject(), type: 'TodayTask' });
            addedTaskIds.add(`TodayTask_${todayTask._id.toString()}`);
        }
    });

    // מיון לפי תאריך מחיקה (החדשות בהתחלה)
    uniqueTasks.sort((a, b) => {
        const dateA = a.deletedAt || a.updatedAt || a.createdAt;
        const dateB = b.deletedAt || b.updatedAt || b.createdAt;
        return new Date(dateB) - new Date(dateA);
    });

    res.json(uniqueTasks);
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
        { model: RecurringTask, type: 'RecurringTask' }, // הוצב לפני TodayTask
        { model: TodayTask, type: 'TodayTask' },
    ];

    for (const { model, type } of models) {
        const entity = await model.findById(taskId);

        if (!entity) continue;



        const isSoftDeleted = entity.isDeleted;
        const isHiddenFromUser = entity.hiddenFrom?.includes(userId);
        const deletedByUser = entity.deletedBy?.toString() === userId;
        const isCreator = entity.creator?.toString() === userId;
        const isMainAssignee = entity.mainAssignee?.toString() === userId;

        const canRestore =
            (isAdmin && (isSoftDeleted || isHiddenFromUser)) ||
            (isCreator && (isSoftDeleted || isHiddenFromUser)) ||
            (isMainAssignee && (isSoftDeleted || isHiddenFromUser)) ||
            (!isAdmin && !isCreator && !isMainAssignee && isHiddenFromUser); // עובד רגיל יכול לשחזר רק הסתרות שלו

        if (!canRestore) {
            console.log(` אין הרשאה לשחזר ${type}`);
            continue;
        }


        // שחזור מחיקה אמיתית (למנהל/יוצר/אחראי ראשי)
        if (isSoftDeleted && (isAdmin || isCreator || isMainAssignee)) {
            entity.isDeleted = false;
            entity.deletedAt = undefined;
            entity.deletedBy = undefined;
        }

        // שחזור הסתרה (לכל המשתמשים)
        if (isHiddenFromUser) {
            entity.hiddenFrom = entity.hiddenFrom.filter(id => id.toString() !== userId);
        }

        // בדיקה אם קיים updatesHistory לפני push
        if (!entity.updatesHistory) {
            entity.updatesHistory = [];
        }

        entity.updatesHistory.push({
            date: new Date(),
            user: userId,
            status: entity.status,
            note: `שחזור משימה (${type})`,
        });

        try {
            await entity.save();
        } catch (error) {
            throw error;
        }

        // שחזור מחיקה אמיתית - עדכון גם ב-TodayTask
        if ((type === 'RecurringTask' || type === 'Task') && isSoftDeleted && (isAdmin || isCreator || isMainAssignee)) {
            try {
                const updateResult = await TodayTask.updateMany(
                    { 
                        sourceTaskId: entity._id,
                        taskModel: type,
                        isDeleted: true 
                    },
                    { 
                        $set: { isDeleted: false },
                        $unset: { 
                            deletedAt: "",
                            deletedBy: ""
                        }
                    }
                );
            } catch (error) {
            }
        }

        if ((type === 'RecurringTask' || type === 'Task') && isHiddenFromUser) {
            try {
                const updateResult = await TodayTask.updateMany(
                    { 
                        sourceTaskId: entity._id,
                        taskModel: type
                    },
                    { 
                        $pull: { hiddenFrom: userId }
                    }
                );
            } catch (error) {
                console.error(` שגיאה בעדכון TodayTask - שחזור הסתרה:`, error);
            }
        }

        // רישום LogDelete
        try {
            await LogDelete.create({
                taskId: entity.taskId,
                taskRef: entity._id,
                action: 'שחזור',
                user: userId,
            });
        } catch (error) {
            console.error(` שגיאה ביצירת LogDelete לשחזור:`, error);
        }

        return res.json({ message: "המשימה שוחזרה בהצלחה!" });
    }

    console.log(` לא נמצאה משימה או אין הרשאה`);
    return res.status(403).json({ message: 'אין לך הרשאה לשחזר משימה זו או שהיא לא קיימת' });
};