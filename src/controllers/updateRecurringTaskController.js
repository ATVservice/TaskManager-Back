import mongoose from 'mongoose';
import RecurringTask from '../models/RecurringTask.js';
import TaskRecurringHistory from '../models/TaskRecurringHistory.js'; // הוסף import
import User from '../models/User.js';
import Association from '../models/Association.js';
import Project from '../models/Project.js'; // הוסף import
import { getTaskPermissionLevel } from '../utils/taskPermissions.js';

// בדיקות בסיסיות ללוגיקת תדירות
function validateFrequency(frequencyType, details) {
  if (!frequencyType) return 'חובה לבחור סוג תדירות';
  switch (frequencyType) {
    case 'יומי':
      return null;
    case 'יומי פרטני':
      if (!details.days || !Array.isArray(details.days) || details.days.length === 0) {
        return 'חובה לבחור לפחות יום אחד ביומי פרטני';
      }
      // אין כפילויות
      const set = new Set(details.days);
      if (set.size !== details.days.length) {
        return 'קיימות כפילויות בימים שנבחרו';
      }
      return null;
    case 'חודשי':
      if (!details.dayOfMonth || details.dayOfMonth < 1 || details.dayOfMonth > 31) {
        return 'חובה לציין יום בחודש בין 1 ל־31';
      }
      return null;
    case 'שנתי':
      if (!details.day || !details.month) {
        return 'חובה לציין יום וחודש עבור תדירות שנתית';
      }
      if (details.month < 1 || details.month > 12) return 'חודש לא חוקי';
      if (details.day < 1 || details.day > 31) return 'יום לא חוקי';
      return null;
    default:
      return 'סוג תדירות לא חוקי';
  }
}

export const updateRecurringTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const user = req.user;

    // ---------- parse body ----------
    const rawBody = req.body || {};
    const updates = rawBody.preparedForm ? rawBody.preparedForm : rawBody;

    console.log('updateRecurringTask debug: received updates:', JSON.stringify(updates));

    // ---------- fetch recurring task ----------
    const task = await RecurringTask.findById(taskId);
    if (!task) {
      res.status(404);
      throw new Error('משימה קבועה לא נמצאה');
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
      if (typeof v === 'object' && v._id) {
        return new mongoose.Types.ObjectId(String(v._id));
      }
      if (typeof v === 'string' && mongoose.isValidObjectId(v)) {
        return new mongoose.Types.ObjectId(v);
      }
      return v;
    };

    const stringifyForHistory = (v) => {
      if (v === undefined || v === null) return null;
      if (v instanceof mongoose.Types.ObjectId) return String(v);
      if (v instanceof Date) return v.toISOString();
      if (Array.isArray(v)) return JSON.stringify(v);
      if (typeof v === 'object') return v._id ? String(v._id) : JSON.stringify(v);
      return String(v);
    };

    const normalizeForCompare = (v) => {
      if (v === undefined || v === null) return null;
      if (v instanceof mongoose.Types.ObjectId) return String(v);
      if (v instanceof Date && !isNaN(v)) return v.toISOString();
      if (Array.isArray(v)) return JSON.stringify(v.sort());
      if (typeof v === 'object') {
        if (v._id) return String(v._id);
        try { return JSON.stringify(v); } catch (e) { return String(v); }
      }
      return String(v);
    };

    const valuesEqual = (a, b) => normalizeForCompare(a) === normalizeForCompare(b);

    // ---------- רק משתמשים עם הרשאה מלאה יכולים לעדכן ----------
    if (permission !== 'full') {
      res.status(403);
      throw new Error('עדכון משימה קבועה מותר רק בהרשאות מלאות.');
    }

    const changes = [];

    for (const [field, incomingValRaw] of Object.entries(updates)) {
      // ❌ לא נוגעים ב־status / notes - הם נשמרים ב-notes/updatesHistory
      if (field === 'status' || field === 'statusNote') continue;

      let saveVal = incomingValRaw;
      if (field === 'organization' || field === 'mainAssignee') {
        saveVal = toObjectId(incomingValRaw);
      } else if (field === 'assignees' && Array.isArray(incomingValRaw)) {
        saveVal = toObjectId(incomingValRaw);
      } else if (field === 'project') {
        saveVal = toObjectId(incomingValRaw);
      }

      const oldVal = task.get(field);
      console.log(`Field "${field}": old=${stringifyForHistory(oldVal)}, incoming=${JSON.stringify(incomingValRaw)}, saveVal=${stringifyForHistory(saveVal)}`);

      if (!valuesEqual(oldVal, saveVal)) {
        task.set(field, saveVal);
        
        // מיפוי שמות השדות לעברית
        const fieldNamesMap = {
          title: 'כותרת',
          details: 'פרטים',
          importance: 'חשיבות',
          subImportance: 'תת דירוג',
          mainAssignee: 'אחראי ראשי',
          status:"סטטוס",
          statusNote:"הערת סטטוס",
          assignees: 'אחראיים',
          project: 'פרויקט',
          organization: 'עמותה',
          frequencyType: 'סוג תדירות',
          frequencyDetails: 'פרטי תדירות'
        };



        changes.push({
          field: fieldNamesMap[field] || field,
          before: stringifyForHistory(oldVal),
          after: stringifyForHistory(saveVal)
        });
      }
    }

    // ---------- ולידציה של תדירות ----------
    if (updates.frequencyType || updates.frequencyDetails) {
      const freqType = updates.frequencyType ?? task.frequencyType;
      const freqDetails = updates.frequencyDetails ?? task.frequencyDetails ?? {};
      const freqError = validateFrequency(freqType, freqDetails);
      if (freqError) {
        res.status(400);
        throw new Error(freqError);
      }
    }

    // ---------- בדיקת subImportance כמו במשימות רגילות ----------
    const importanceChange = changes.find(c => c.field === 'חשיבות');
    if (importanceChange) {
      const newImportance = importanceChange.after;
      const newImportanceStr = newImportance === null ? null : String(newImportance);
      if (newImportanceStr !== 'מיידי') {
        const existingSub = task.get('subImportance');
        if (existingSub !== undefined && existingSub !== null && existingSub !== '') {
          changes.push({
            field: 'תת דירוג',
            before: stringifyForHistory(existingSub),
            after: null
          });

          try {
            task.set('subImportance', undefined);
            if (Object.prototype.hasOwnProperty.call(task, 'subImportance')) {
              delete task.subImportance;
            }
            task.markModified && task.markModified('subImportance');
          } catch (e) {
            console.error('Failed to unset subImportance on recurring task:', e);
          }
        }
      }
    }

    if (changes.length === 0) {
      res.status(403);
      throw new Error('אין שינויים לשמירה.');
    }

    // ---------- save ----------
    task.updatesHistory.push({
      date: new Date(),
      user: user._id,
      note: 'עדכון משימה קבועה'
    });

    await task.save();

    // populate fields
    await task.populate('organization');
    await task.populate('mainAssignee');
    await task.populate('assignees');
    await task.populate('project');

    // ---------- הכנת היסטוריית שינויים קריאה (כמו במשימות רגילות) ----------
    const userIdsToResolve = new Set();
    const assocIdsToResolve = new Set();
    const projectIdsToResolve = new Set();

    for (const c of changes) {
      if (c.field === 'אחראי ראשי') {
        if (c.before) userIdsToResolve.add(c.before);
        if (c.after) userIdsToResolve.add(c.after);
      } else if (c.field === 'אחראיים') {
        try {
          const beforeArr = JSON.parse(c.before || '[]');
          beforeArr.forEach(i => userIdsToResolve.add(i));
        } catch {}
        try {
          const afterArr = JSON.parse(c.after || '[]');
          afterArr.forEach(i => userIdsToResolve.add(i));
        } catch {}
      } else if (c.field === 'עמותה') {
        if (c.before) assocIdsToResolve.add(c.before);
        if (c.after) assocIdsToResolve.add(c.after);
      } else if (c.field === 'פרויקט') {
        if (c.before) projectIdsToResolve.add(c.before);
        if (c.after) projectIdsToResolve.add(c.after);
      }
    }

    // המרת Sets למערכים תקינים
    const userIds = Array.from(userIdsToResolve)
      .map(id => String(id))
      .filter(id => mongoose.isValidObjectId(id));

    const assocIds = Array.from(assocIdsToResolve)
      .map(id => String(id))
      .filter(id => mongoose.isValidObjectId(id));

    const projectIds = Array.from(projectIdsToResolve)
      .map(id => String(id))
      .filter(id => id && mongoose.isValidObjectId(id));

    console.log('IDs to resolve:', { userIds, assocIds, projectIds });

    // בקשות DB מקבילות לקבלת שמות
    const [usersMapArr, assocsMapArr, projectsMapArr] = await Promise.all([
      userIds.length ? User.find({ _id: { $in: userIds } }).select('_id userName').lean() : [],
      assocIds.length ? Association.find({ _id: { $in: assocIds } }).select('_id name').lean() : [],
      projectIds.length ? Project.find({ _id: { $in: projectIds } }).select('_id name').lean() : []
    ]);

    console.log("Retrieved data:", { usersMapArr, assocsMapArr, projectsMapArr });

    // בניית מיפוי id -> name
    const userNameMap = new Map(usersMapArr.map(u => [String(u._id), u.userName]));
    const assocNameMap = new Map(assocsMapArr.map(a => [String(a._id), a.name]));
    const projectNameMap = new Map(projectsMapArr.map(p => [String(p._id), p.name]));

    // פונקציה להמיר ערכים לייצוג קריא
    const humanizeValue = (val) => {
      if (val === undefined || val === null || val === '') return null;

      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) {
            return parsed.map(p => (userNameMap.get(String(p)) || String(p))).join(', ');
          }
        } catch (e) {
          // לא JSON — נמשיך
        }
        
        if (userNameMap.has(val)) return userNameMap.get(val);
        if (assocNameMap.has(val)) return assocNameMap.get(val);
        if (projectNameMap.has(val)) return projectNameMap.get(val);
        return val;
      }

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

      return String(val);
    };

    // בניית רשומות היסטוריה עם שמות במקום IDs
    const historyRecords = changes.map(c => ({
      taskId,
      user: user._id,
      field: c.field,
      before: humanizeValue(c.before),
      after: humanizeValue(c.after),
      date: new Date()
    }));

    // שמירת ההיסטוריה במסד הנתונים
    await TaskRecurringHistory.insertMany(historyRecords);

    console.log('RecurringTask changes history saved:', historyRecords);

    return res.json({ message: 'המשימה הקבועה עודכנה בהצלחה', task });
  } catch (err) {
    console.error('updateRecurringTask error:', err);
    const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(statusCode).json({ message: err.message || 'שגיאה בעדכון המשימה הקבועה' });
  }
};

export default updateRecurringTask;