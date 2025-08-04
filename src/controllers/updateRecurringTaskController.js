import RecurringTask from '../models/RecurringTask.js';
import TaskHistory from '../models/TaskHistory.js';
import { getTaskPermissionLevel } from '../utils/taskPermissions.js';


export const updateRecurringTask = async (req, res) => {

    const { taskId } = req.params;
    const user = req.user;

    const task = await RecurringTask.findById(taskId);
    if (!task) {
        res.status(404);
        throw new Error('משימה קבועה לא נמצאה')
    }
    const permission = getTaskPermissionLevel(task, user);
    if (permission === 'none') {
        res.status(403);
        throw new Error('אין לך הרשאה לעדכן משימה זו')
    }


    if (permission === 'limited') {
        res.status(403);
        throw new Error('אין לך הרשאה לערוך משימה קבועה')
    }

    const updates = req.body;
    const changes = [];

    const blockedFields = ['status', 'completed'];
    for (const [field, newVal] of Object.entries(updates)) {
        if (blockedFields.includes(field)) continue;
        const oldVal = task[field];
        if (oldVal !== undefined && String(oldVal) !== String(newVal)) {
            task[field] = newVal;
            changes.push({ field, before: oldVal, after: newVal });
        }
    }

    if (changes.length === 0) {
        res.status(403);
        throw new Error('אין שינויים מותרים לשמירה');
    }

    task.updatedAt = new Date();
    task.updatesHistory.push({
        date: new Date(),
        user: user._id,
        status: task.status,
        note: 'עריכה כללית במשימה קבועה'
    });

    await task.save();

    const history = changes.map(change => ({
        taskId,
        user: user._id,
        field: change.field,
        before: change.before,
        after: change.after,
        date: new Date()
    }));
    await TaskHistory.insertMany(history);

    return res.json({ message: 'משימה קבועה עודכנה בהצלחה', task });

};