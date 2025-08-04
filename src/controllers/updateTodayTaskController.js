import TodayTask from '../models/TodayTask.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import TaskHistory from '../models/TaskHistory.js';
import { getTaskPermissionLevel } from '../utils/taskPermissions.js';


export const updateTodayTask = async (req, res) => {
    const { taskId } = req.params;
    const user = req.user;

    const task = await TodayTask.findById(taskId);
    if (!task)
        {
            res.status(404);
            throw new Error('משימת היום לא נמצאה')
        } 

    const permission = getTaskPermissionLevel(task, user);
    if (permission === 'none') {
        res.status(403);
        throw new Error('אין לך הרשאה לעדכן משימה זו')
      }

    const updates = req.body;
    const changes = [];

    if (task.isRecurringInstance && permission !== 'full') {
        res.status(400);
        throw new Error('אין לעדכן מופע ממשימה קבועה – ערוך את המשימה המקורית')
    }

    if (permission === 'limited') {
        const allowed = ['status', 'updateText', 'completed'];
      const personalUpdates = {};
      for (const field of allowed) {
        if (updates[field] !== undefined) {
          personalUpdates[field] = updates[field];
        }
      }

      if (Object.keys(personalUpdates).length === 0) {
        res.status(403);
        throw new Error('אין שדות מותרים לעדכון')
      }

      const current = await TaskAssigneeDetails.findOneAndUpdate(
        { taskId, user: user._id, taskModel: 'TodayTask' },
        personalUpdates,
        { upsert: true, new: true }
      );

      // תיעוד היסטוריה אישית
      const history = Object.entries(personalUpdates).map(([field, newVal]) => ({
        taskId,
        user: user._id,
        field: `personal.${field}`,
        before: current?.[field] ?? null,
        after: newVal,
        date: new Date()
      }));
      await TaskHistory.insertMany(history);

      return res.json({ message: 'עדכון אישי נשמר בהצלחה' });
    }

    for (const [field, newVal] of Object.entries(updates)) {
      const oldVal = task[field];
      if (oldVal !== undefined && String(oldVal) !== String(newVal)) {
        task[field] = newVal;
        changes.push({ field, before: oldVal, after: newVal });
      }
    }

    if (changes.length === 0) {
        res.status(403);
        throw new Error('אין שינויים לשמירה')
    }

    task.updatedAt = new Date();
    task.updatesHistory.push({
      date: new Date(),
      user: user._id,
      status: updates.status || task.status,
      note: updates.statusNote || ''
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

    return res.json({ message: 'משימת היום עודכנה בהצלחה', task });

};
