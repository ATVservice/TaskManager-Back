import mongoose from 'mongoose';
import RecurringTask from '../models/RecurringTask.js';
import User from '../models/User.js';
import Association from '../models/Association.js';
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
      // ❌ לא נוגעים ב־status / notes
      if (field === 'status' || field === 'notes') continue;

      let saveVal = incomingValRaw;
      if (field === 'organization' || field === 'mainAssignee') {
        saveVal = toObjectId(incomingValRaw);
      } else if (field === 'assignees' && Array.isArray(incomingValRaw)) {
        saveVal = toObjectId(incomingValRaw);
      }

      const oldVal = task.get(field);
      if (!valuesEqual(oldVal, saveVal)) {
        task.set(field, saveVal);
        changes.push({
          field,
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

    // ---------- הכנת היסטוריית שינויים קריאה ----------
    const userIdsToResolve = new Set();
    const assocIdsToResolve = new Set();

    for (const c of changes) {
      if (c.field === 'mainAssignee') {
        if (c.before) userIdsToResolve.add(c.before);
        if (c.after) userIdsToResolve.add(c.after);
      } else if (c.field === 'assignees') {
        try {
          const beforeArr = JSON.parse(c.before);
          beforeArr.forEach(i => userIdsToResolve.add(i));
        } catch {}
        try {
          const afterArr = JSON.parse(c.after);
          afterArr.forEach(i => userIdsToResolve.add(i));
        } catch {}
      } else if (c.field === 'organization') {
        if (c.before) assocIdsToResolve.add(c.before);
        if (c.after) assocIdsToResolve.add(c.after);
      }
    }

    const [usersMapArr, assocsMapArr] = await Promise.all([
      userIdsToResolve.size ? User.find({ _id: { $in: Array.from(userIdsToResolve) } }).select('_id userName').lean() : [],
      assocIdsToResolve.size ? Association.find({ _id: { $in: Array.from(assocIdsToResolve) } }).select('_id name').lean() : []
    ]);

    const userNameMap = new Map(usersMapArr.map(u => [String(u._id), u.userName]));
    const assocNameMap = new Map(assocsMapArr.map(a => [String(a._id), a.name]));

    const humanizeValue = (val) => {
      if (!val) return null;
      if (userNameMap.has(val)) return userNameMap.get(val);
      if (assocNameMap.has(val)) return assocNameMap.get(val);
      return val;
    };

    const historyRecords = changes.map(c => ({
      taskId,
      user: user._id,
      field: c.field,
      before: humanizeValue(c.before),
      after: humanizeValue(c.after),
      date: new Date()
    }));

    // כאן אפשר לשמור historyRecords בקולקציה ייעודית אם תרצי
    console.log('RecurringTask changes history:', historyRecords);

    return res.json({ message: 'המשימה הקבועה עודכנה בהצלחה', task });
  } catch (err) {
    console.error('updateRecurringTask error:', err);
    const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(statusCode).json({ message: err.message || 'שגיאה בעדכון המשימה הקבועה' });
  }
};

export default updateRecurringTask;
