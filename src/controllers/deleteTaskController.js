import LogDelete from "../models/LogDelete.js";
import RecurringTask from "../models/RecurringTask.js";
import Task from "../models/Task.js";
import TodayTask from "../models/TodayTask.js";
import User from "../models/User.js";
import validatePassword from "../utils/validatePassword.js";

const handleSoftDelete = async ({ entity, entityType, userId, isAdmin, isCreator, isAssignee, isMainAssignee, res, deleteRecurringSource = true }) => {
    // מנהל או יוצר או אחראי ראשי - מחיקה אמיתית
    if (isAdmin || isCreator || isMainAssignee) {        
        entity.isDeleted = true;
        entity.deletedAt = new Date();
        entity.deletedBy = userId;

        // בדיקה אם קיים updatesHistory לפני push
        if (!entity.updatesHistory) {
            entity.updatesHistory = [];
        }
        entity.updatesHistory.push({
            date: new Date(),
            user: userId,
            status: entity.status,
            note: `מחיקה רכה (${entityType})`
        });

        try {
            await entity.save();
        } catch (error) {
            console.error(` שגיאה בשמירת ${entityType}:`, error);
            throw error;
        }

        // רישום LogDelete
        try {
            await LogDelete.create({
                taskId: entity.taskId,
                taskRef: entity._id,
                action: 'מחיקה',
                user: userId,
            });
            console.log(` LogDelete נוצר בהצלחה`);
        } catch (error) {
            console.error(` שגיאה ביצירת LogDelete:`, error);
        }

        // עדכון TodayTask ל-isDeleted: true - תמיד למשימות Task ו-RecurringTask
        if (entityType === 'RecurringTask' || entityType === 'Task') {
            try {
                const updateResult = await TodayTask.updateMany(
                    { sourceTaskId: entity._id, taskModel: entityType },
                    {
                        $set: {
                            isDeleted: true,
                            deletedAt: new Date(),
                            deletedBy: userId
                        }
                    }
                );
                console.log(` עודכנו ${updateResult.modifiedCount} TodayTask records`);
            } catch (error) {
                console.error(` שגיאה בעדכון TodayTask:`, error);
            }
        }

        return res.json({ message: `המשימה נמחקה (${entityType})` });
    }

    // עובד רגיל (assignee) - הוספה ל-hiddenFrom
    if (isAssignee) {
        
        // בדיקה אם קיים hiddenFrom לפני השימוש ב-includes
        if (!entity.hiddenFrom) {
            entity.hiddenFrom = [];
        }
        
        if (!entity.hiddenFrom.includes(userId)) {
            entity.hiddenFrom.push(userId);
        }

        // בדיקה אם קיים updatesHistory לפני push
        if (!entity.updatesHistory) {
            entity.updatesHistory = [];
        }

        entity.updatesHistory.push({
            date: new Date(),
            user: userId,
            status: entity.status,
            note: `המשימה הוסתרה מהתצוגה שלך בלבד (${entityType})`
        });

        try {
            await entity.save();
            console.log(` ${entityType} נשמר בהצלחה עם hiddenFrom`);
        } catch (error) {
            console.error(` שגיאה בשמירת ${entityType}:`, error);
            throw error;
        }

        // עדכון גם ב-TodayTask - הוספה ל-hiddenFrom
        if (entityType === 'RecurringTask' || entityType === 'Task') {
            try {
                const updateResult = await TodayTask.updateMany(
                    { sourceTaskId: entity._id, taskModel: entityType },
                    {
                        $addToSet: { hiddenFrom: userId }
                    }
                );
                console.log(` עודכנו ${updateResult.modifiedCount} TodayTask records עם hiddenFrom`);
            } catch (error) {
                console.error(` שגיאה בעדכון TodayTask hiddenFrom:`, error);
            }
        }

        return res.json({ message: `המשימה נמחקה מהתצוגה שלך בלבד (${entityType})` });
    }

    console.log(` אין הרשאה למחיקה`);
    res.status(403);
    throw new Error('אין לך הרשאה למחוק משימה זו.');
};
// מחיקת משימה נמחקת גם ממשימות להיום
// אם מוחקים ממשימות להיום לא נמחק מהמופע המקורי אלא אם כן הוא מחק משם
// כלומר לדוגמא מחק משימה קבועה אז היא כן נמחקת וגם המופע שלה להיום נמחק אבל לא הפוך
// אם זה לא ראשי/מנהל/יוצר מוסתר רק למשתמש עצמו
export const softDeleteTask = async (req, res) => {
    const taskId = req.params.taskId;
    const isTodayTask = req.params.isTodayTask === 'true'; 
    const userId = req.user.id;
    const userRole = req.user.role;
    const password = req.body.password;


    const isValidPassword = await validatePassword(userId, password);
    if (!isValidPassword) {
        console.log(` סיסמה שגויה`);
        res.status(401);
        throw new Error('סיסמה שגויה');
    }

    const isAdmin = userRole === 'מנהל';

    // אם isTodayTask=true, חפש רק TodayTask
    if (isTodayTask) {
        const entity = await TodayTask.findById(taskId);
        
        if (!entity) {
            res.status(404);
            throw new Error('משימה לא נמצאה');
        }

        const isCreator = entity.creator?.toString() === userId;
        const isMainAssignee = entity.mainAssignee?.toString() === userId;
        const isAssignee = entity.assignees?.some(u => u.toString() === userId) && !isMainAssignee;
        
        // מחק רק את TodayTask - לא נוגע ב-RecurringTask המקורי
        return await handleSoftDelete({ 
            entity, 
            entityType: 'TodayTask', 
            userId, 
            isAdmin, 
            isCreator, 
            isAssignee, 
            isMainAssignee, 
            res,
            skipSourceUpdate: true 
        });
    }

    let entity = await Task.findById(taskId);
    if (entity) {
        const isCreator = entity.creator?.toString() === userId;
        const isMainAssignee = entity.mainAssignee?.toString() === userId;
        const isAssignee = entity.assignees?.some(u => u.toString() === userId) && !isMainAssignee;
        return await handleSoftDelete({ entity, entityType: 'Task', userId, isAdmin, isCreator, isAssignee, isMainAssignee, res });
    }

    entity = await RecurringTask.findById(taskId);
    if (entity) {

        const isCreator = entity.creator?.toString() === userId;
        const isMainAssignee = entity.mainAssignee?.toString() === userId;
        const isAssignee = entity.assignees?.some(u => u.toString() === userId) && !isMainAssignee;
        console.log(`🔍 RecurringTask permissions:`, { isCreator, isMainAssignee, isAssignee });
        
        return await handleSoftDelete({ entity, entityType: 'RecurringTask', userId, isAdmin, isCreator, isAssignee, isMainAssignee, res });
    }

    entity = await TodayTask.findById(taskId);
    if (entity) {
        const isCreator = entity.creator?.toString() === userId;
        const isMainAssignee = entity.mainAssignee?.toString() === userId;
        const isAssignee = entity.assignees?.some(u => u.toString() === userId) && !isMainAssignee;
        
        // אם זה TodayTask ממשימה קבועה ו-isTodayTask=false, מחק גם את המקור
        if (entity.taskModel === 'RecurringTask' && entity.sourceTaskId) {
            
            const sourceRecurring = await RecurringTask.findById(entity.sourceTaskId);
            if (sourceRecurring) {
                const recurringIsCreator = sourceRecurring.creator?.toString() === userId;
                const recurringIsMainAssignee = sourceRecurring.mainAssignee?.toString() === userId;
                const recurringIsAssignee = sourceRecurring.assignees?.some(u => u.toString() === userId) && !recurringIsMainAssignee;
                
                // מחק את RecurringTask (זה יעדכן אוטומטית את כל TodayTask הקשורים)
                return await handleSoftDelete({ 
                    entity: sourceRecurring, 
                    entityType: 'RecurringTask', 
                    userId, 
                    isAdmin, 
                    isCreator: recurringIsCreator,
                    isAssignee: recurringIsAssignee, 
                    isMainAssignee: recurringIsMainAssignee, 
                    res
                });
            }
        }
        
        // עבור TodayTask רגיל (לא ממשימה קבועה)
        return await handleSoftDelete({ entity, entityType: 'TodayTask', userId, isAdmin, isCreator, isAssignee, isMainAssignee, res });
    }

    // לא נמצאה משימה
    console.log(` לא נמצאה משימה עם ID: ${taskId}`);
    res.status(404);
    throw new Error('משימה לא נמצאה');
};