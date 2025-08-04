import Task from '../models/Task.js';
import TaskHistory from '../models/TaskHistory.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import { getTaskPermissionLevel } from '../utils/taskPermissions.js';


export const updateTask = async (req, res) => {
  const { taskId } = req.params;
    const user = req.user;
    const allowedStatuses = ['בתהליך', 'הושלם', 'מושהה', 'בטיפול', 'בוטלה'];


    const task = await Task.findById(taskId);
    if (!task){
      res.status(404);
      throw new Error("משימה לא נמצאה")
    }

    const permission = getTaskPermissionLevel(task, user);
    if (permission === 'none') {
      res.status(403);
      throw new Error("אין לך הרשאה לעדכן משימה זו.")
    }

    const updates = req.body;
    const changes = [];

    if (permission === 'limited') {
   
      
      const allowed = ['status', 'statusNote'];
      const personalUpdates = {};
      for (const field of allowed) {
        if (updates[field] !== undefined) {
          personalUpdates[field] = updates[field];
        }
      }
      // בדיקת תקינות הסטטוס
      if (personalUpdates.status && !allowedStatuses.includes(personalUpdates.status)) {
        res.status(400);
        throw new Error(`הסטטוס "${personalUpdates.status}" אינו תקין`);
      }


      if (Object.keys(personalUpdates).length === 0) {
        res.status(403);
        throw new Error("אין שדות מותרים לעדכון")
      }
      const previous = await TaskAssigneeDetails.findOne({ taskId, user: user._id, taskModel: 'Task' });
      
      const current = await TaskAssigneeDetails.findOneAndUpdate(
        { taskId, user: user._id, taskModel: 'Task' },
        personalUpdates,
        { upsert: true, new: true }
      );

      // תיעוד היסטוריה אישית
      const history = Object.entries(personalUpdates).map(([field, newVal]) => ({
        taskId,
        user: user._id,
        field: `personal.${field}`,
        before: previous?.[field] ?? null,
        after: newVal,
        date: new Date()
      }));
      await TaskHistory.insertMany(history);

      return res.json({ message: 'עדכון אישי נשמר בהצלחה' });
    }

    // מנהל / יוצר / ראשי
    for (const [field, newVal] of Object.entries(updates)) {
      const oldVal = task[field];
      if (field === 'status' && !allowedStatuses.includes(newVal)) {
        res.status(400);
        throw new Error(`הסטטוס "${newVal}" אינו תקין`);
      }
      if (oldVal !== undefined && String(oldVal) !== String(newVal)) {
        task[field] = newVal;
        changes.push({ field, before: oldVal, after: newVal });
      }
    }

    if (changes.length === 0) {
      res.status(403);
      throw new Error("אין שינויים לשמירה.")
    }

    task.updatedAt = new Date();
    task.updatesHistory.push({
      date: new Date(),
      user: user._id,
      status: updates.status || task.status,
      note: updates.statusNote || ''
    });
    await task.save();

    // תיעוד כללי
    const history = changes.map(change => ({
      taskId,
      user: user._id,
      field: change.field,
      before: change.before,
      after: change.after,
      date: new Date()
    }));
    await TaskHistory.insertMany(history);

    return res.json({ message: 'המשימה עודכנה בהצלחה', task });

};
