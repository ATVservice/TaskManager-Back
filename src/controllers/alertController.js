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
    const staleDrawerTasks = await Task.find({
        importance: 'מגירה',
        updatedAt: { $lt: fourteenDaysAgo },
        isDeleted: false
    });

    for (const task of staleDrawerTasks) {
        const creatorId = task.creator;
        await createAlertIfNotExists('משימת מגירה לא עודכנה 14 ימים', task._id, creatorId);
    }

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
        const existingDetails = await TaskAssigneeDetails.find({
            task: task._id,
            user: { $in: task.assignees },
        });

        const statusMap = new Map();
        for (const detail of existingDetails) {
            statusMap.set(detail.user.toString(), detail.status);
        }

        const notCompletedAssignees = task.assignees.filter((userId) => {
            const status = statusMap.get(userId.toString());
            return !status || status !== 'הושלם';
        });

        const taskItselfNotCompleted = !task.status || task.status === 'מגירה';

        if ((notCompletedAssignees.length > 0 || taskItselfNotCompleted) && task.mainAssignee) {
            await createAlertIfNotExists(
                'לא עודכן ע"י אחד האחראים',
                task._id,
                task.mainAssignee
            );
        }

        if (
            task.importance === 'מגירה' &&
            task.updatedAt < fourteenDaysAgo &&
            task.mainAssignee
        ) {
            await createAlertIfNotExists(
                'משימת מגירה לא עודכנה 14 ימים',
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
        isDeleted: false
    });

    for (const task of longUncompletedOnceTasks) {
        for (const admin of adminUsers) {
            await createAlertIfNotExists('משימה חד"פ לא הושלמה 30 ימים', task._id, admin._id);
        }
    }

    const allStaleDrawers = await Task.find({
        importance: 'מגירה',
        updatedAt: { $lt: fourteenDaysAgo },
        isDeleted: false
    });

    for (const task of allStaleDrawers) {
        for (const admin of adminUsers) {
            await createAlertIfNotExists('משימת מגירה לא עודכנה 14 ימים', task._id, admin._id);
        }
    }
};

const createAlertIfNotExists = async (type, taskId, userId) => {
    const task = await Task.findOne({ _id: taskId, isDeleted: false });
    if (!task) return; // לא ליצור התראה על משימה שנמחקה
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


// שליפת התרעות למשתמש
export const getUserAlerts = async (req, res) => {

    const user = req.user;
    if (!user || !user._id) {
        res.status(401);
        throw new Error('משתמש לא מאומת');
    }

    const userId = String(user._id);

    const {
        resolved,
        limit = 10,
        skip = 0,
        sortBy = 'createdAt',
        order = 'desc'
    } = req.query;

    const filter = { recipient: new mongoose.Types.ObjectId(userId) };

    if (resolved === 'true') filter.resolved = true;
    else if (resolved === 'false') filter.resolved = false;

    const total = await Alert.countDocuments(filter);

    // קבע את כיוון המיון עבור שדות תאריכים
    const sortOrder = order === 'asc' ? 1 : -1;

    // אם המשתמש לא סינן לפי resolved, נוסיף מיון ראשוני לפי resolved
    // (false קודם => לא נקראו קודם)
    const includeResolvedInSort = (resolved === undefined);

    if (sortBy === 'taskDueDate') {
        // מיון לפי dueDate שנמצא בטבלה tasks — נשתמש ב-aggregate
        // אם לא סיננו לפי resolved, נוסיף sort על resolved ראשון
        const aggSort = {};
        if (includeResolvedInSort) aggSort.resolved = 1; // false (0) יופיע קודם
        aggSort['task.dueDate'] = sortOrder;
        // לשם יציבות, נוסיף createdAt כסעיף משלים מהגבוה ביותר או הנמוך
        aggSort.createdAt = -1;

        const aggPipeline = [
            { $match: filter },
            {
                $lookup: {
                    from: 'tasks',
                    localField: 'task',
                    foreignField: '_id',
                    as: 'task'
                }
            },
            { $unwind: { path: '$task', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    task: {
                        _id: 1,
                        taskId: 1,
                        title: 1,
                        status: 1,
                        mainAssignee: 1,
                        organization: 1,
                        dueDate: '$task.dueDate'
                    },
                    type: 1,
                    recipient: 1,
                    createdAt: 1,
                    resolved: 1,
                    details: 1
                }
            },
            { $sort: aggSort },
            { $skip: Number(skip) },
            { $limit: Number(limit) }
        ];

        const alerts = await Alert.aggregate(aggPipeline);
        return res.json({ total, count: alerts.length, alerts });
    } else {

        const sortStage = {};
        if (includeResolvedInSort) {
            sortStage.resolved = 1; // false קודם
        }

        // הוספת שדה המיון העיקרי
        if (sortBy === 'createdAt') {
            sortStage.createdAt = sortOrder;
        } else {
            sortStage[sortBy] = sortOrder;
            if (!sortStage.createdAt) sortStage.createdAt = -1;
        }

        const alerts = await Alert.find(filter)
            .sort(sortStage)
            .skip(Number(skip))
            .limit(Number(limit))
            .populate({
                path: 'task',
                select: '_id taskId title status mainAssignee organization dueDate'
            })
            .lean();

        return res.json({ total, count: alerts.length, alerts });
    }

};
// סימון התרעות שנקראו
export const markRead = async (req, res) => {

    const { alertIds } = req.body;
    if (!Array.isArray(alertIds) || alertIds.length === 0) {
        res.status(400);
        throw new Error("לא התקבלו התרעות")
    }
    const objectIds = alertIds
        .filter(id => mongoose.isValidObjectId(id))
        .map(id => new mongoose.Types.ObjectId(id));
    await Alert.updateMany({ _id: { $in: objectIds } }, { $set: { resolved: true } });
    return res.json({ message: 'marked' });

}
