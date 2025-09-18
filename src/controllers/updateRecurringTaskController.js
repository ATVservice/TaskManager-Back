import mongoose from 'mongoose';
import RecurringTask from '../models/RecurringTask.js';
import TaskRecurringHistory from '../models/TaskRecurringHistory.js';
import User from '../models/User.js';
import Association from '../models/Association.js';
import Project from '../models/Project.js';
import { getTaskPermissionLevel } from '../utils/taskPermissions.js';
import { isTaskForToday, addTaskToToday  } from '../utils/TaskForToday.js';
import TodayTask from '../models/TodayTask.js';


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
    const wasTaskForToday = isTaskForToday(task, true);



    // טיפול מיוחד בשינוי סוג תדירות - ניקוי frequencyDetails הישן
    if (updates.frequencyType && updates.frequencyType !== task.frequencyType) {
      // אם משנים את סוג התדירות, ננקה לחלוטין את frequencyDetails
      task.set('frequencyDetails', {});
      console.log('Cleared old frequencyDetails due to frequencyType change');
    }

    for (const [field, incomingValRaw] of Object.entries(updates)) {
      // לא נוגעים ב־status / notes - הם נשמרים ב-notes/updatesHistory
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

      // טיפול מיוחד ב-frequencyDetails - החלפה מלאה במקום מיזוג
      if (field === 'frequencyDetails') {
        // תמיד החלף לחלוטין את frequencyDetails
        const cleanedNewDetails = saveVal || {};
        task.set('frequencyDetails', cleanedNewDetails);
        
        // רק אם יש הבדל אמיתי
        if (!valuesEqual(oldVal, cleanedNewDetails)) {
          changes.push({
            field: 'פרטי תדירות',
            beforeRaw: oldVal,
            afterRaw: cleanedNewDetails,
            before: null,
            after: null
          });
        }
        continue;
      }

      if (!valuesEqual(oldVal, saveVal)) {
        task.set(field, saveVal);
        
        // מיפוי שמות השדות לעברית
        const fieldNamesMap = {
          title: 'כותרת',
          details: 'פרטים',
          importance: 'חשיבות',
          subImportance: 'תת דירוג',
          mainAssignee: 'אחראי ראשי',
          status: 'סטטוס',
          statusNote: 'הערת סטטוס',
          assignees: 'אחראיים',
          project: 'פרויקט',
          organization: 'עמותה',
          frequencyType: 'סוג תדירות',
          frequencyDetails: 'פרטי תדירות'
        };

        // שמירת הערכים המקוריים (לא JSON) לשימוש מאוחר יותר
        changes.push({
          field: fieldNamesMap[field] || field,
          beforeRaw: oldVal,  // הערך המקורי
          afterRaw: saveVal,  // הערך החדש המקורי
          before: null,       // יוגדר מאוחר יותר עם השמות
          after: null         // יוגדר מאוחר יותר עם השמות
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
      const newImportanceStr = importanceChange.afterRaw === null ? null : String(importanceChange.afterRaw);
      if (newImportanceStr !== 'מיידי') {
        const existingSub = task.get('subImportance');
        if (existingSub !== undefined && existingSub !== null && existingSub !== '') {
          changes.push({
            field: 'תת דירוג',
            beforeRaw: existingSub,
            afterRaw: null,
            before: null,
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

    // ---------- עדכון משימות היום לאחר השמירה ----------
const isTaskForTodayAfterUpdate = isTaskForToday(task, true);

// בדיקה אם יש שינוי ברלוונטיות ליום
if (wasTaskForToday !== isTaskForTodayAfterUpdate) {
  console.log(`Task ${taskId} relevance for today changed: ${wasTaskForToday} -> ${isTaskForTodayAfterUpdate}`);
  
  if (isTaskForTodayAfterUpdate) {
    // המשימה צריכה להיות היום - בדוק אם היא כבר קיימת
    const existingTodayTask = await TodayTask.findOne({ 
      sourceTaskId: taskId,
      taskModel: 'RecurringTask'
    });
    
    if (!existingTodayTask) {
      try {
        await addTaskToToday(task, true);
        console.log(`Added recurring task ${taskId} to today tasks`);
      } catch (error) {
        console.error(`Failed to add recurring task ${taskId} to today:`, error);
      }
    }
  } else {
    // המשימה לא צריכה להיות היום - הסר אותה
    try {
      const deletedCount = await TodayTask.deleteMany({ 
        sourceTaskId: taskId,
        taskModel: 'RecurringTask'
      });
      if (deletedCount.deletedCount > 0) {
        console.log(`Removed recurring task ${taskId} from today tasks (${deletedCount.deletedCount} instances)`);
      }
    } catch (error) {
      console.error(`Failed to remove recurring task ${taskId} from today:`, error);
    }
  }
} else if (isTaskForTodayAfterUpdate) {
  // המשימה עדיין רלוונטית להיום - עדכן את המשימה ב-TodayTask אם קיימת
  try {
    const existingTodayTask = await TodayTask.findOne({ 
      sourceTaskId: taskId,
      taskModel: 'RecurringTask'
    });
    
    if (existingTodayTask) {
      // עדכן את הנתונים במשימת היום
      const updatedData = {
        title: task.title,
        details: task.details,
        importance: task.importance,
        subImportance: task.subImportance,
        mainAssignee: task.mainAssignee,
        assignees: task.assignees,
        project: task.project && task.project !== "" ? task.project : null,
        organization: task.organization
      };
      
      await TodayTask.updateOne(
        { _id: existingTodayTask._id },
        { $set: updatedData }
      );
      
      console.log(`Updated recurring task ${taskId} in today tasks`);
    }
  } catch (error) {
    console.error(`Failed to update recurring task ${taskId} in today tasks:`, error);
  }
}

    // populate fields
    await task.populate('organization');
    await task.populate('mainAssignee');
    await task.populate('assignees');
    await task.populate('project');

    // ---------- הכנת היסטוריית שינויים קריאה ----------
    const userIdsToResolve = new Set();
    const assocIdsToResolve = new Set();
    const projectIdsToResolve = new Set();

    for (const c of changes) {
      if (c.field === 'אחראי ראשי') {
        const beforeId = c.beforeRaw instanceof mongoose.Types.ObjectId ? String(c.beforeRaw) : c.beforeRaw;
        const afterId = c.afterRaw instanceof mongoose.Types.ObjectId ? String(c.afterRaw) : c.afterRaw;
        if (beforeId) userIdsToResolve.add(beforeId);
        if (afterId) userIdsToResolve.add(afterId);
      } else if (c.field === 'אחראיים') {
        const beforeArr = Array.isArray(c.beforeRaw) ? c.beforeRaw : [];
        const afterArr = Array.isArray(c.afterRaw) ? c.afterRaw : [];
        beforeArr.forEach(id => userIdsToResolve.add(String(id)));
        afterArr.forEach(id => userIdsToResolve.add(String(id)));
      } else if (c.field === 'עמותה') {
        const beforeId = c.beforeRaw instanceof mongoose.Types.ObjectId ? String(c.beforeRaw) : c.beforeRaw;
        const afterId = c.afterRaw instanceof mongoose.Types.ObjectId ? String(c.afterRaw) : c.afterRaw;
        if (beforeId) assocIdsToResolve.add(beforeId);
        if (afterId) assocIdsToResolve.add(afterId);
      } else if (c.field === 'פרויקט') {
        const beforeId = c.beforeRaw instanceof mongoose.Types.ObjectId ? String(c.beforeRaw) : c.beforeRaw;
        const afterId = c.afterRaw instanceof mongoose.Types.ObjectId ? String(c.afterRaw) : c.afterRaw;
        if (beforeId) projectIdsToResolve.add(beforeId);
        if (afterId) projectIdsToResolve.add(afterId);
      }
    }

    // המרת Sets למערכים תקינים
    const userIds = Array.from(userIdsToResolve).filter(id => mongoose.isValidObjectId(id));
    const assocIds = Array.from(assocIdsToResolve).filter(id => mongoose.isValidObjectId(id));
    const projectIds = Array.from(projectIdsToResolve).filter(id => mongoose.isValidObjectId(id));

    // בקשות DB מקבילות לקבלת שמות
    const [usersMapArr, assocsMapArr, projectsMapArr] = await Promise.all([
      userIds.length ? User.find({ _id: { $in: userIds } }).select('_id userName').lean() : [],
      assocIds.length ? Association.find({ _id: { $in: assocIds } }).select('_id name').lean() : [],
      projectIds.length ? Project.find({ _id: { $in: projectIds } }).select('_id name').lean() : []
    ]);

    // בניית מיפוי id -> name
    const userNameMap = new Map(usersMapArr.map(u => [String(u._id), u.userName]));
    const assocNameMap = new Map(assocsMapArr.map(a => [String(a._id), a.name]));
    const projectNameMap = new Map(projectsMapArr.map(p => [String(p._id), p.name]));

    // פונקציה להמרת פרטי תדירות לטקסט קריא
    const humanizeFrequencyDetails = (details, frequencyType) => {
      if (!details || typeof details !== 'object') return details;
      
      try {
        switch (frequencyType) {
          case 'יומי':
            return details.includingFriday ? 'כולל ימי שישי' : 'ללא ימי שישי';
          
          case 'יומי פרטני':
            if (details.days && Array.isArray(details.days)) {
              const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
              const selectedDays = details.days.map(dayNum => dayNames[dayNum] || dayNum).join(', ');
              return `ימים: ${selectedDays}`;
            }
            return 'ימים לא צוינו';
          
          case 'חודשי':
            return details.dayOfMonth ? `יום ${details.dayOfMonth} בחודש` : 'יום לא צוין';
          
          case 'שנתי':
            if (details.day && details.month) {
              const monthNames = ['', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 
                               'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
              const monthName = monthNames[details.month] || details.month;
              return `${details.day} ב${monthName}`;
            }
            return 'תאריך לא צוין';
          
          default:
            return JSON.stringify(details);
        }
      } catch (e) {
        return String(details);
      }
    };

    // פונקציה להמיר ערכים לייצוג קריא
    const humanizeValue = (val, fieldName) => {
      if (val === undefined || val === null || val === '') return null;

      // טיפול מיוחד בפרטי תדירות
      if (fieldName === 'פרטי תדירות') {
        const currentFrequencyType = task.frequencyType || updates.frequencyType;
        return humanizeFrequencyDetails(val, currentFrequencyType);
      }

      // טיפול באחראיים (מערך)
      if (fieldName === 'אחראיים' && Array.isArray(val)) {
        return val.map(id => userNameMap.get(String(id)) || String(id)).join(', ');
      }

      // טיפול באחראי ראשי
      if (fieldName === 'אחראי ראשי') {
        const idStr = String(val);
        return userNameMap.get(idStr) || idStr;
      }

      // טיפול בעמותה
      if (fieldName === 'עמותה') {
        const idStr = String(val);
        return assocNameMap.get(idStr) || idStr;
      }

      // טיפול בפרויקט
      if (fieldName === 'פרויקט') {
        const idStr = String(val);
        return projectNameMap.get(idStr) || idStr;
      }

      return String(val);
    };

    // עכשיו המרת כל השינויים לטקסט קריא
    const historyRecords = changes.map(c => ({
      taskId,
      user: user._id,
      field: c.field,
      before: humanizeValue(c.beforeRaw, c.field),
      after: humanizeValue(c.afterRaw, c.field),
      date: new Date()
    }));

    // שמירת ההיסטוריה במסד הנתונים
    if (historyRecords.length > 0) {
      await TaskRecurringHistory.insertMany(historyRecords);
    }

    console.log('RecurringTask changes history saved:', historyRecords);

    return res.json({ message: 'המשימה הקבועה עודכנה בהצלחה', task });
  } catch (err) {
    console.error('updateRecurringTask error:', err);
    const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(statusCode).json({ message: err.message || 'שגיאה בעדכון המשימה הקבועה' });
  }
};

export default updateRecurringTask;