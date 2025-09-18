import mongoose from 'mongoose';
import Task from '../models/Task.js';
import TaskHistory from '../models/TaskHistory.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import User from '../models/User.js';
import Association from '../models/Association.js';
import Project from '../models/Project.js';
import { getTaskPermissionLevel } from '../utils/taskPermissions.js';
import TodayTask from '../models/TodayTask.js';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween.js';

dayjs.extend(isBetween);

// בודק האם לשנות לכולם להושלם
// מסמן משימה כהושלמה אם צריך
async function checkAndMarkTaskCompleted(taskId) {
  const task = await Task.findById(taskId);
  if (!task) return;

  const details = await TaskAssigneeDetails.find({ taskId: task._id, taskModel: 'Task' });
  if (!details) return;

  // אם הראשי השלים → מספיק כדי להשלים את המשימה
  const mainDetail = details.find(d => String(d.user) === String(task.mainAssignee));
  if (mainDetail && mainDetail.status === 'הושלם') {
    await Task.findByIdAndUpdate(taskId, { status: 'הושלם' });
    return;
  }

  // אם אחד מהמשתמשים הוא מנהל והשלים → מספיק
  const managerCompleted = await User.exists({
    _id: { $in: details.filter(d => d.status === 'הושלם').map(d => d.user) },
    role: 'מנהל'
  });
  if (managerCompleted) {
    await Task.findByIdAndUpdate(taskId, { status: 'הושלם' });
    return;
  }

  // בדיקה אם כל המשניים השלימו
  const secondaryIds = task.assignees
    .map(a => String(a))
    .filter(a => String(a) !== String(task.mainAssignee));

  if (secondaryIds.length === 0) return;

  const secondaryDetails = details.filter(d => secondaryIds.includes(String(d.user)));

  // אם חסר אחד מהמשניים (עוד לא עדכן בכלל) → לא משלים
  if (secondaryDetails.length !== secondaryIds.length) return;

  const allSecondaryCompleted = secondaryDetails.every(d => d.status === 'הושלם');
  if (allSecondaryCompleted) {
    await Task.findByIdAndUpdate(taskId, { status: 'הושלם' });
  }
}

// מבטל הושלם אם צריך
async function checkAndUnsetTaskCompletedIfNeeded(taskId, changedUserId, newStatus) {
  if (newStatus === 'הושלם') return; // לא נוגעים כשמישהו משלים

  const task = await Task.findById(taskId);
  if (!task || task.status !== 'הושלם') return;

  const details = await TaskAssigneeDetails.find({ taskId: task._id, taskModel: 'Task' });

  // אם הראשי שינה לסטטוס שאינו הושלם → בטל הושלם
  if (String(task.mainAssignee) === String(changedUserId)) {
    await Task.findByIdAndUpdate(taskId, { status: 'בטיפול' });
    return;
  }

  // אם המשתמש מנהל → בטל הושלם
  const changedUser = await User.findById(changedUserId);
  if (changedUser?.role === 'מנהל') {
    await Task.findByIdAndUpdate(taskId, { status: 'בטיפול' });
    return;
  }

  // בדיקה אם נשאר משני אחד לפחות שלא השלים
  const secondaryIds = task.assignees
    .map(a => String(a))
    .filter(a => String(a) !== String(task.mainAssignee));

  const secondaryDetails = details.filter(d => secondaryIds.includes(String(d.user)));

  const someSecondaryNotCompleted = secondaryDetails.some(d => d.status !== 'הושלם');

  if (someSecondaryNotCompleted) {
    await Task.findByIdAndUpdate(taskId, { status: 'בטיפול' });
  }
}

export const updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;
    const allowedStatuses = ['לביצוע', 'הושלם', 'בטיפול', 'בוטלה'];

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
        try { return JSON.stringify(v); } catch (e) { return String(v); }
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
      if (personalUpdates.status && personalUpdates.status !== previous?.status) {
        await checkAndUnsetTaskCompletedIfNeeded(taskId, user._id, personalUpdates.status);
      }


      await checkAndMarkTaskCompleted(taskId);

      const fieldNamesMap = {
        status: 'סטטוס',
        statusNote: 'הערת סטטוס'
      };

      const history = Object.entries(personalUpdates).map(([field, newVal]) => ({
        taskId,
        user: user._id,
        field: fieldNamesMap[field] || field,
        before: previous ? previous[field] : task[field],
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
        const fieldNamesMap = {
          title: 'כותרת',
          details: 'פרטים',
          dueDate: 'תאריך יעד',
          finalDeadline: 'תאריך סופי',
          importance: 'חשיבות',
          subImportance: 'תת דירוג',
          status: 'סטטוס',
          statusNote: "הערת סטטוס",
          mainAssignee: 'אחראי ראשי',
          assignees: 'אחראיים',
          project: 'פרויקט',
          organization: 'עמותה',
          frequencyDetails: 'פרטי תדירות',
          frequencyType: 'סוג תדירות',
          failureReason: 'סיבת אי ביצוע'
        };

        if (field === 'failureReason') {
          // טיפול מותאם אישית לשדה failureReason
          changes.push({
            field: fieldNamesMap[field] || field,
            before: oldVal ? (oldVal.option === 'אחר' ? oldVal.customText : oldVal.option) : null,
            after: saveVal ? (saveVal.option === 'אחר' ? saveVal.customText : saveVal.option) : null
          });
        } else {
          changes.push({
            field: fieldNamesMap[field] || field,
            before: stringifyForHistory(oldVal),
            after: stringifyForHistory(saveVal)
          });
        }
      }
    }
    // בדיקה אם תאריך נדחה (לא רק שונה)
    // const dateFields = ['dueDate', 'finalDeadline'];
    // let dateDelayed = false;

    // for (const f of dateFields) {
    //   const oldVal = task.get(f);
    //   const newVal = updates[f];
    //   if (newVal && !valuesEqual(oldVal, newVal)) {
    //     const oldDate = oldVal ? new Date(oldVal) : null;
    //     const newDate = new Date(newVal);

    //     // בדיקה אם התאריך החדש מאוחר יותר מהישן (דחייה)
    //     if (oldDate && newDate > oldDate) {
    //       dateDelayed = true;
    //       break;
    //     }
    //   }
    // }

    // if (dateDelayed) {
    //   // קבל את החשיבות הנוכחית (אחרי העדכונים)
    //   const currentImportance = updates.importance !== undefined ? updates.importance : task.importance;

    //   const failureReason = updates.failureReason;
    //   if (!failureReason || (!failureReason.option && !failureReason.customText)) {
    //     // דרוש סיבת אי ביצוע רק אם זה לא משימת מגירה ורק כשמדחים תאריך
    //     if (currentImportance !== "מגירה") {
    //       console.log("@@@current importance", currentImportance, "- date delayed, failure reason required");
    //       res.status(400);
    //       throw new Error('חובה לספק סיבת אי ביצוע כאשר מדחים את התאריך');
    //     }
    //   }

    //   if (failureReason && failureReason.option === 'אחר' &&
    //     (!failureReason.customText || failureReason.customText.trim() === '') &&
    //     currentImportance !== "מגירה") {
    //     res.status(400);
    //     throw new Error('חובה למלא פירוט כאשר הסיבה היא "אחר"');
    //   }

    //   // עדכן את סיבת האי ביצוע רק כשמדחים תאריך (ולא משימת מגירה)
    //   if (failureReason) {
    //     task.set('failureReason', failureReason);
    //   }
    // }

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

    await task.save();

    // --- existing logic של TodayTask ---
    if (task.dueDate) {
      const today = dayjs().startOf('day');
      const endOfToday = dayjs().endOf('day');

      if (dayjs(task.dueDate).isBetween(today, endOfToday, null, '[]')) {
        const exists = await TodayTask.findOne({ sourceTaskId: task._id, isRecurringInstance: false });
        if (!exists) {
          await TodayTask.create({
            ...task.toObject(),
            sourceTaskId: task._id,
            taskModel: "Task",
            isRecurringInstance: false
          });
        }
      } else {
        await TodayTask.deleteOne({ sourceTaskId: task._id, isRecurringInstance: false });
      }
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
            taskModel: "Task",
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
    const projectIdsToResolve = new Set();

    for (const c of changes) {
      // הערכים before/after ב-changes הם סטרינגים שיצרנו בעזרת stringifyForHistory
      // נזהה מצבים רלוונטיים לפי שם השדה
      if (c.field === 'אחראי ראשי') {
        if (c.before) userIdsToResolve.add(c.before);
        if (c.after) userIdsToResolve.add(c.after);
      } else if (c.field === 'אחראיים') {
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
      } else if (c.field === 'עמותה') {
        if (c.before) assocIdsToResolve.add(c.before);
        if (c.after) assocIdsToResolve.add(c.after);
      }
      else if (c.field === 'פרויקט') { // שדה project (שם עברי)
        if (c.before) projectIdsToResolve.add(c.before);
        if (c.after) projectIdsToResolve.add(c.after);
      }
    }

    // המרת ה־Sets למערכים תקינים (והסרת ערכים לא תקינים)
    const userIds = Array.from(userIdsToResolve)
      .map(id => String(id))
      .filter(id => mongoose.isValidObjectId(id));

    const assocIds = Array.from(assocIdsToResolve)
      .map(id => String(id))
      .filter(id => mongoose.isValidObjectId(id));

    const projectIds = Array.from(projectIdsToResolve)
      .map(id => String(id))
      .filter(id => id && mongoose.isValidObjectId(id));

    console.log('IDs to resolve:', { userIds, assocIds, projectIds }); // דיבאג

    // בקשות DB מקבילות לקבלת שמות - הוסף גם Project
    const [usersMapArr, assocsMapArr, projectsMapArr] = await Promise.all([
      userIds.length ? User.find({ _id: { $in: userIds } }).select('_id userName').lean() : [],
      assocIds.length ? Association.find({ _id: { $in: assocIds } }).select('_id name').lean() : [],
      projectIds.length ? Project.find({ _id: { $in: projectIds } }).select('_id name').lean() : []
    ]);

    console.log("Retrieved data:", { usersMapArr, assocsMapArr, projectsMapArr });


    // בוני מיפוי id -> name
    const userNameMap = new Map(usersMapArr.map(u => [String(u._id), u.userName]));
    const assocNameMap = new Map(assocsMapArr.map(a => [String(a._id), a.name]));
    const projectNameMap = new Map(projectsMapArr.map(p => [String(p._id), p.name]));


    // פונקציה עזר להמיר ערכים לייצוג קריא
    const humanizeValue = (val) => {
      if (val === undefined || val === null || val === '') return null;

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
        if (projectNameMap.has(val)) return projectNameMap.get(val); // הוסף את זה

        return val;
      }

      // אם זה object עם _id
      if (typeof val === 'object') {
        if (val._id) {
          const idStr = String(val._id);
          if (userNameMap.has(idStr)) return userNameMap.get(idStr);
          if (assocNameMap.has(idStr)) return assocNameMap.get(idStr);
          if (projectNameMap.has(idStr)) return projectNameMap.get(idStr);

          if (val.name) return val.name;
          if (val.userName) return val.userName;
          return idStr;
        }

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
