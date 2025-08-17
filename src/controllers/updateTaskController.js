import mongoose from 'mongoose';
import Task from '../models/Task.js';
import TaskHistory from '../models/TaskHistory.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import User from '../models/User.js';
import Association from '../models/Association.js';
import { getTaskPermissionLevel } from '../utils/taskPermissions.js';
import TodayTask from '../models/TodayTask.js';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween.js';

dayjs.extend(isBetween);

async function checkAndMarkTaskCompleted(taskId) {
  const details = await TaskAssigneeDetails.find({ taskId, taskModel: 'Task' });
  if (details.length > 0 && details.every(d => d.status === 'הושלם')) {
    await Task.findByIdAndUpdate(taskId, { status: 'הושלם' });
  }
}

export const updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;
    const allowedStatuses = ['בתהליך', 'הושלם', 'מושהה', 'בטיפול', 'בוטלה'];

    // ---------- parse body (support preparedForm wrapper) ----------
    const rawBody = req.body || {};
    const updates = rawBody.preparedForm ? rawBody.preparedForm : rawBody;

    // ---------- fetch task ----------
    const task = await Task.findById(taskId);
    if (!task) {
      res.status(404);
      throw new Error('משימה לא נמצאה');
    }

    // ---------- permission ----------
    const permission = getTaskPermissionLevel(task, user);
    if (permission === 'none') {
      res.status(403);
      throw new Error('אין לך הרשאה לעדכן משימה זו.');
    }

    // ---------- helpers ----------
    const toObjectId = (v) => {
      if (v === undefined || v === null) return v;
      if (v instanceof mongoose.Types.ObjectId) return v;
      if (Array.isArray(v)) return v.map(i => toObjectId(i));
      // object with _id
      if (typeof v === 'object' && v._id) {
        const id = String(v._id);
        if (mongoose.isValidObjectId(id)) return new mongoose.Types.ObjectId(id);
        return v._id;
      }
      // string id
      if (typeof v === 'string' && mongoose.isValidObjectId(v)) {
        return new mongoose.Types.ObjectId(v);
      }
      // fallback: return as-is
      return v;
    };

    const isDateLike = (v) => {
      if (!v) return false;
      if (v instanceof Date && !isNaN(v)) return true;
      return !isNaN(Date.parse(String(v)));
    };

    const normalizeForCompare = (v) => {
      if (v === undefined || v === null) return null;
      if (v instanceof mongoose.Types.ObjectId) return String(v);
      if (v instanceof Date && !isNaN(v)) return v.toISOString();
      if (Array.isArray(v)) return JSON.stringify(v.map(x => normalizeForCompare(x)).sort());
      if (typeof v === 'object') {
        if (v._id) return String(v._id);
        try { return JSON.stringify(v); } catch(e) { return String(v); }
      }
      return String(v);
    };

    const valuesEqual = (a, b) => {
      const na = normalizeForCompare(a);
      const nb = normalizeForCompare(b);
      return na === nb;
    };

    const stringifyForHistory = (v) => {
      if (v === undefined || v === null) return null;
      if (v instanceof mongoose.Types.ObjectId) return String(v);
      if (v instanceof Date) return v.toISOString();
      if (Array.isArray(v)) return JSON.stringify(v.map(x => (x && x._id ? String(x._id) : x)));
      if (typeof v === 'object') return v._id ? String(v._id) : JSON.stringify(v);
      return String(v);
    };

    // ---------- helper: who can cancel ----------
    const canCancelTask = (userObj, taskObj) => {
      if (!userObj || !taskObj) return false;
      // user role admin can cancel
      if (userObj.role === 'מנהל') return true;

      const userIdStr = String(userObj._id || userObj.id || userObj);
      // creator can cancel
      if (taskObj.creator && String(taskObj.creator) === userIdStr) return true;

      // mainAssignee can cancel - task.mainAssignee might be object or id
      const mainAssigneeId = taskObj.mainAssignee && (taskObj.mainAssignee._id ? String(taskObj.mainAssignee._id) : String(taskObj.mainAssignee));
      if (mainAssigneeId && mainAssigneeId === userIdStr) return true;

      return false;
    };

    // ---------- limited-permission branch (personal updates only) ----------
    if (permission === 'limited') {
      const allowed = ['status', 'statusNote'];
      const personalUpdates = {};
      for (const field of allowed) {
        if (updates[field] !== undefined) personalUpdates[field] = updates[field];
      }

      if (personalUpdates.status && !allowedStatuses.includes(personalUpdates.status)) {
        res.status(400);
        throw new Error(`הסטטוס "${personalUpdates.status}" אינו תקין`);
      }

      // NEW: disallow cancelling unless authorized
      if (personalUpdates.status === 'בוטלה' && !canCancelTask(user, task)) {
        res.status(403);
        throw new Error('רק האחראי הראשי, מקים המשימה או המנהל יכולים לבטל משימה.');
      }

      if (Object.keys(personalUpdates).length === 0) {
        res.status(403);
        throw new Error('אין שדות מותרים לעדכון');
      }

      const previous = await TaskAssigneeDetails.findOne({ taskId, user: user._id, taskModel: 'Task' });
      const current = await TaskAssigneeDetails.findOneAndUpdate(
        { taskId, user: user._id, taskModel: 'Task' },
        personalUpdates,
        { upsert: true, new: true }
      );

      await checkAndMarkTaskCompleted(taskId);

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

    // ---------- full-permission branch ----------
    const changes = [];

    // Debug log of incoming updates
    console.log('updateTask debug: received updates:', JSON.stringify(updates));

    for (const [field, incomingValRaw] of Object.entries(updates)) {
      // ignore properties that are not schema fields (optional)
      // convert incoming value to the type we want to compare/save
      let incomingVal = incomingValRaw;
      let saveVal = incomingValRaw;

      // validate status
      if (field === 'status' && incomingVal && !allowedStatuses.includes(incomingVal)) {
        res.status(400);
        throw new Error(`הסטטוס "${incomingVal}" אינו תקין`);
      }

      // NEW: if attempting to set status to 'בוטלה' enforce who can cancel
      if (field === 'status' && incomingVal === 'בוטלה' && !canCancelTask(user, task)) {
        res.status(403);
        throw new Error('רק האחראי הראשי, מקים המשימה או המנהל יכולים לבטל משימה.');
      }

      // special handling for IDs / arrays / dates
      if (field === 'organization' && incomingVal !== undefined && incomingVal !== null) {
        saveVal = toObjectId(incomingVal);
      } else if (field === 'mainAssignee' && incomingVal !== undefined && incomingVal !== null) {
        saveVal = toObjectId(incomingVal);
      } else if (field === 'assignees' && Array.isArray(incomingVal)) {
        saveVal = toObjectId(incomingVal);
      } else if ((field === 'dueDate' || field === 'finalDeadline') && isDateLike(incomingVal)) {
        saveVal = incomingVal instanceof Date ? incomingVal : new Date(incomingVal);
      } else {
        // keep saveVal as incomingVal for primitives/objects
        saveVal = incomingVal;
      }

      const oldVal = task.get(field);

      console.log(`Field "${field}": old=${stringifyForHistory(oldVal)}, incoming=${JSON.stringify(incomingVal)}, saveVal=${stringifyForHistory(saveVal)}`);

      if (!valuesEqual(oldVal, saveVal)) {
        // Set value on task with care for arrays and ObjectId instances
        if (field === 'organization' || field === 'mainAssignee') {
          task.set(field, saveVal);
        } else if (field === 'assignees') {
          // ensure array of ObjectIds
          task.set('assignees', saveVal);
        } else if (field === 'dueDate' || field === 'finalDeadline') {
          task.set(field, saveVal);
        } else {
          task.set(field, saveVal);
        }

        changes.push({
          field,
          before: stringifyForHistory(oldVal),
          after: stringifyForHistory(saveVal)
        });
      }
    }

    // ---- NEW: if importance changed and is no longer "מיידי", remove subImportance ----
    // We do this here (before save) so the DB won't keep the old subImportance value.
    const importanceChange = changes.find(c => c.field === 'importance');
    if (importanceChange) {
      const newImportance = importanceChange.after; // string or null
      // normalize to string
      const newImportanceStr = newImportance === null ? null : String(newImportance);
      if (newImportanceStr !== 'מיידי') {
        const existingSub = task.get('subImportance');
        if (existingSub !== undefined && existingSub !== null && existingSub !== '') {
          // add history record for the removal
          changes.push({
            field: 'subImportance',
            before: stringifyForHistory(existingSub),
            after: null
          });

          // actually remove the field from the document so Mongoose will $unset it
          try {
            task.set('subImportance', undefined);
            if (Object.prototype.hasOwnProperty.call(task, 'subImportance')) {
              delete task.subImportance;
            }
            task.markModified && task.markModified('subImportance');
          } catch (e) {
            console.error('Failed to unset subImportance on task object:', e);
          }
        }
      }
    }

    if (changes.length === 0) {
      res.status(403);
      throw new Error('אין שינויים לשמירה.');
    }

    // update metadata
    task.updatedAt = new Date();
    task.updatesHistory.push({
      date: new Date(),
      user: user._id,
      status: updates.status || task.status,
      note: updates.statusNote || ''
    });

    // save and populate
    await task.save();

// אם עודכן תאריך היעד להיום אז זה יתווסיף למשימות להיום
//וכן להיפך, אם נדחה התאריך הוא יוסר ממשימות להיום 
if (task.dueDate) {
  const today = dayjs().startOf('day');
  const endOfToday = dayjs().endOf('day');

  if (dayjs(task.dueDate).isBetween(today, endOfToday, null, '[]')) {
    const exists = await TodayTask.findOne({ sourceTaskId: task._id, isRecurringInstance: false });
    if (!exists) {
      await TodayTask.create({
        ...task.toObject(),
        sourceTaskId: task._id,
        isRecurringInstance: false
      });
      console.log(`✅ Task ${task._id} added to TodayTask`);
    }
  } else {
    // אם התאריך כבר לא היום – למחוק מהטבלה (כדי לא להציג בטעות)
    await TodayTask.deleteOne({ sourceTaskId: task._id, isRecurringInstance: false });
  }
}



    // populate fields for response clarity
    await task.populate('organization');
    await task.populate('mainAssignee');
    await task.populate('assignees');

    // ----------------
    // המרת IDs לשמות קריאים לפני שמירת ההיסטוריה
    // ----------------

    // אסוף כל ה-ids שצריך לרזולב
    const userIdsToResolve = new Set();
    const assocIdsToResolve = new Set();

    for (const c of changes) {
      // הערכים before/after ב-changes הם סטרינגים שיצרנו בעזרת stringifyForHistory
      // נזהה מצבים רלוונטיים לפי שם השדה
      if (c.field === 'mainAssignee') {
        if (c.before) userIdsToResolve.add(c.before);
        if (c.after) userIdsToResolve.add(c.after);
      } else if (c.field === 'assignees') {
        // assignees נשמרו כסטרינג של JSON או כמחרוזת; ננסה לפענח
        if (c.before) {
          try {
            const parsed = JSON.parse(c.before);
            if (Array.isArray(parsed)) parsed.forEach(i => userIdsToResolve.add(i));
            else userIdsToResolve.add(c.before);
          } catch (e) {
            userIdsToResolve.add(c.before);
          }
        }
        if (c.after) {
          try {
            const parsed = JSON.parse(c.after);
            if (Array.isArray(parsed)) parsed.forEach(i => userIdsToResolve.add(i));
            else userIdsToResolve.add(c.after);
          } catch (e) {
            userIdsToResolve.add(c.after);
          }
        }
      } else if (c.field === 'organization') {
        if (c.before) assocIdsToResolve.add(c.before);
        if (c.after) assocIdsToResolve.add(c.after);
      }
    }

    // המרת ה־Sets למערכים תקינים (והסרת ערכים לא תקינים)
    const userIds = Array.from(userIdsToResolve)
      .map(id => String(id))
      .filter(id => mongoose.isValidObjectId(id));
    const assocIds = Array.from(assocIdsToResolve)
      .map(id => String(id))
      .filter(id => mongoose.isValidObjectId(id));

    // בקשות DB מקבילות לקבלת שמות
    const [usersMapArr, assocsMapArr] = await Promise.all([
      userIds.length ? User.find({ _id: { $in: userIds } }).select('_id userName').lean() : [],
      assocIds.length ? Association.find({ _id: { $in: assocIds } }).select('_id name').lean() : []
    ]);

    // בוני מיפוי id -> name
    const userNameMap = new Map(usersMapArr.map(u => [String(u._id), u.userName]));
    const assocNameMap = new Map(assocsMapArr.map(a => [String(a._id), a.name]));

    // פונקציה עזר להמיר ערכים לייצוג קריא
    const humanizeValue = (val) => {
      if (val === undefined || val === null) return null;

      // אם זה מחרוזת שנראית כמו JSON של מערך
      if (typeof val === 'string') {
        // מנסה לפרש JSON של מערך
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) {
            return parsed.map(p => (userNameMap.get(String(p)) || String(p))).join(', ');
          }
        } catch (e) {
          // לא JSON — נמשיך
        }
        // יכול להיות שזה id של user או assoc
        if (userNameMap.has(val)) return userNameMap.get(val);
        if (assocNameMap.has(val)) return assocNameMap.get(val);
        return val;
      }

      // אם זה object עם _id
      if (typeof val === 'object') {
        if (val._id) {
          const idStr = String(val._id);
          if (userNameMap.has(idStr)) return userNameMap.get(idStr);
          if (assocNameMap.has(idStr)) return assocNameMap.get(idStr);
          if (val.name) return val.name;
          if (val.userName) return val.userName;
          return idStr;
        }
        // fallback: stringify
        try { return JSON.stringify(val); } catch (e) { return String(val); }
      }

      // מספר/שאר המקרים
      return String(val);
    };

    // עכשיו בוני רשומות היסטוריה עם שמות במקום ids
    const historyRecords = changes.map(c => ({
      taskId,
      user: user._id,
      field: c.field,
      before: humanizeValue(c.before),
      after: humanizeValue(c.after),
      date: new Date()
    }));

    // הכנס היסטוריה למסד
    await TaskHistory.insertMany(historyRecords);

    // החזר תשובה
    return res.json({ message: 'המשימה עודכנה בהצלחה', task });

  } catch (err) {
    console.error('updateTask error:', err);
    const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(statusCode).json({ message: err.message || 'שגיאה בעדכון המשימה' });
  }
};

export default updateTask;
