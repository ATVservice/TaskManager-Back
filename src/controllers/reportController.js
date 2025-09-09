import mongoose from 'mongoose';
import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';
import User from '../models/User.js';
import Association from '../models/Association.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import Goal from '../models/Goal.js';
import UserFilter from '../models/UserFilter.js';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

// הוספת plugins
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);



// פונקציות עזר חדשות למסד נתונים
export const saveUserFilter = async (userId, screenType, filters) => {
  try {
    const cleanFilters = cleanEmptyFilters(filters);

    const result = await UserFilter.findOneAndUpdate(
      { userId, screenType },
      {
        filters: cleanFilters,
        lastUsed: new Date()
      },
      {
        upsert: true,
        new: true,
        runValidators: true
      }
    );

    console.log(`Filter saved for user ${userId}, screen: ${screenType}`, cleanFilters);
    return result;
  } catch (error) {
    console.error('Error saving user filter:', error);
    throw error;
  }
};

export const loadUserFilter = async (userId, screenType) => {
  try {
    const userFilter = await UserFilter.findOne({ userId, screenType });

    if (!userFilter) {
      return {};
    }

    await UserFilter.findByIdAndUpdate(userFilter._id, {
      lastUsed: new Date()
    });

    return userFilter.filters || {};
  } catch (error) {
    console.error('Error loading user filter:', error);
    return {};
  }
};

export const resetUserFilter = async (userId, screenType) => {
  try {
    await UserFilter.findOneAndDelete({ userId, screenType });
    console.log(`Filter reset for user ${userId}, screen: ${screenType}`);
    return true;
  } catch (error) {
    console.error('Error resetting user filter:', error);
    throw error;
  }
};

const cleanEmptyFilters = (filters) => {
  const cleaned = {};

  Object.keys(filters).forEach(key => {
    const value = filters[key];

    if (value !== null && value !== undefined && value !== '' && value !== 'all') {
      if (Array.isArray(value)) {
        if (value.length > 0) {
          cleaned[key] = value;
        }
      } else {
        cleaned[key] = value;
      }
    }
  });

  return cleaned;
};

export const loadSavedFilter = async (req, res) => {
  try {
    const { screenType } = req.params;
    const userId = req.user.id;

    const savedFilter = await loadUserFilter(userId, screenType);

    res.json({
      success: true,
      filter: savedFilter
    });

  } catch (error) {
    console.error('Error in loadSavedFilter:', error);
    res.status(500).json({
      success: false,
      message: 'שגיאה בטעינת פילטר שמור'
    });
  }
};

export const resetFilter = async (req, res) => {
  try {
    const { screenType } = req.params;
    const userId = req.user.id;

    await resetUserFilter(userId, screenType);

    res.json({
      success: true,
      message: 'הפילטר אופס בהצלחה'
    });

  } catch (error) {
    console.error('Error in resetFilter:', error);
    res.status(500).json({
      success: false,
      message: 'שגיאה באיפוס פילטר'
    });
  }
};

export const getAllUserFilters = async (req, res) => {
  try {
    const userId = req.user.id;
    const filters = await getUserAllFilters(userId);

    res.json({
      success: true,
      filters
    });

  } catch (error) {
    console.error('Error in getAllUserFilters:', error);
    res.status(500).json({
      success: false,
      message: 'שגיאה בקבלת פילטרים'
    });
  }
};

// פונקציית עזר לקבלת פרטי assignee
const getAssigneeDetails = async (taskId, taskModel, userId = null) => {
  const query = { taskId, taskModel };
  if (userId) query.user = userId;

  return await TaskAssigneeDetails.find(query).populate('user', 'firstName lastName userName');
};

// פונקציה חדשה להמרת משימות קבועות לביצועים נפרדים
const expandRecurringTasks = (recurringTasks, dateFilter = null) => {
  const expandedTasks = [];

  recurringTasks.forEach(task => {
    // אם אין notes, זה אומר שהמשימה לא בוצעה אף פעם
    if (!task.notes || task.notes.length === 0) {
      // נכלול את המשימה הקבועה עצמה כ"לא בוצעה"
      expandedTasks.push({
        ...task.toObject(),
        taskType: 'קבועה',
        noteDate: null,
        noteStatus: task.status, // הסטטוס הנוכחי של המשימה הקבועה
        noteContent: null,
        isFromNote: false,
        daysOpen: task.daysOpen || 0
      });
    } else {
      // עבור כל note, נוצר ביצוע נפרד
      task.notes.forEach(note => {
        // בדיקת פילטר תאריך אם קיים
        if (dateFilter && dateFilter.startDate && dateFilter.endDate) {
          const noteDate = new Date(note.date);
          const startDate = new Date(dateFilter.startDate);
          const endDate = new Date(dateFilter.endDate);

          if (noteDate < startDate || noteDate > endDate) {
            return; // דלג על note זה
          }
        }

        expandedTasks.push({
          ...task.toObject(),
          taskType: 'קבועה',
          noteDate: note.date,
          noteStatus: note.status,
          noteContent: note.content,
          noteUser: note.user,
          isFromNote: true,
          // חישוב ימים פתוחים מיום יצירת המשימה עד תאריך ה-note
          daysOpen: Math.floor((new Date(note.date) - new Date(task.createdAt)) / (1000 * 60 * 60 * 24))
        });
      });
    }
  });

  return expandedTasks;
};

// פונקציה אחידה לבניית פילטר
function buildTaskFilter(query) {
  const {
    employeeId,
    startDate,
    endDate,
    importance,
    subImportance,
    associationId,
    status,
    reasonId
  } = query;

  let filter = { isDeleted: { $ne: true } };

  // עובד
  if (employeeId) {
    filter.$or = [
      { creator: employeeId },
      { mainAssignee: employeeId },
      { assignees: { $in: [employeeId] } }
    ];
  }

  // טווח תאריכים - עבור משימות קבועות נבדוק גם ב-notes
  if (startDate && endDate) {
    filter.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }

  // חשיבות ותת־חשיבות
  if (importance) filter.importance = importance;
  if (subImportance) filter.subImportance = subImportance;

  // עמותה
  if (associationId) filter.organization = associationId;

  // סטטוס
  if (status) {
    filter.status = Array.isArray(status) ? { $in: status } : status;
  }

  // סיבת אי ביצוע
  if (reasonId) {
    filter.failureReason = reasonId;
  }

  return filter;
}
// 
// מקבל את המשימה והמשתמש ומחזיר את הסטטוס הנכון
const getTaskStatusForUser = (task, userId) => {
  if (task.taskModel === "Task") {
    // נבדוק האם יש למשתמש רשומה ב-TaskAssigneeDetails
    const assigneeDetail = task.taskAssigneeDetails?.find(
      (d) => d.user.toString() === userId.toString()
    );
    if (assigneeDetail) {
      return assigneeDetail.status; // הסטטוס הספציפי של המשתמש
    }
    return task.status; // fallback לסטטוס הכללי
  }

  // במשימה קבועה לא נוגעים
  return task.status;
};

// 1. דוח משימות פתוחות לפי עובדים - מעודכן
export const getOpenTasksByEmployee = async (req, res) => {
  try {
    const { status = ['בטיפול', 'לביצוע'] } = req.query;
    const userId = req.user.id;

    saveUserFilter(userId, 'openTasks', req.query);

    const { employeeId, ...filterParams } = req.query;
    let baseFilter = buildTaskFilter({ ...filterParams, status });

    // המרת מזהי Mongo
    if (baseFilter.organization) {
      baseFilter.organization = new mongoose.Types.ObjectId(baseFilter.organization);
    }
    if (baseFilter.$or) {
      baseFilter.$or = baseFilter.$or.map(cond => {
        const newCond = { ...cond };
        Object.keys(newCond).forEach(key => {
          if (['creator', 'mainAssignee'].includes(key)) newCond[key] = new mongoose.Types.ObjectId(newCond[key]);
          if (key === 'assignees' && newCond[key].$in) newCond[key].$in = newCond[key].$in.map(id => new mongoose.Types.ObjectId(id));
        });
        return newCond;
      });
    }

    // שליפת משימות רגילות וקבועות
    const regularTasks = await Task.find(baseFilter)
      .populate('creator', 'firstName lastName userName role')
      .populate('mainAssignee', 'firstName lastName userName role')
      .populate('assignees', 'firstName lastName userName role')
      .populate('organization', 'name')
      .sort({ createdAt: -1 });

    const recurringTasks = await RecurringTask.find(baseFilter)
      .populate('creator', 'firstName lastName userName role')
      .populate('mainAssignee', 'firstName lastName userName role')
      .populate('assignees', 'firstName lastName userName role')
      .populate('organization', 'name')
      .populate('notes.user', 'firstName lastName userName role')
      .sort({ createdAt: -1 });

    const expandedRecurringTasks = expandRecurringTasks(recurringTasks, {
      startDate: req.query.startDate,
      endDate: req.query.endDate
    });

    const regularIds = regularTasks.map(t => t._id);
    const recurringIds = expandedRecurringTasks.map(t => t._id);

    const allAssigneeDetails = await TaskAssigneeDetails.find({
      $or: [
        { taskId: { $in: regularIds }, taskModel: 'Task' },
        { taskId: { $in: recurringIds }, taskModel: 'RecurringTask' }
      ]
    }).populate('user', 'firstName lastName userName role');

    const detailsByTask = {};
    allAssigneeDetails.forEach(d => {
      detailsByTask[d.taskId.toString()] = detailsByTask[d.taskId.toString()] || [];
      detailsByTask[d.taskId.toString()].push(d);
    });

    const allTasks = [
      ...regularTasks.map(t => ({ ...t.toObject(), taskType: 'רגילה', assigneeDetails: detailsByTask[t._id.toString()] || [] })),
      ...expandedRecurringTasks.map(t => ({ ...t, taskType: 'קבועה', assigneeDetails: detailsByTask[t._id.toString()] || [] }))
    ];

    const tasksByEmployee = {};

    for (const task of allTasks) {
      const employees = [];

      // מוסיפים יוצר, אחראי ראשי, אחראים משניים
      if (task.creator) employees.push({ user: task.creator, role: 'יוצר' });
      if (task.mainAssignee) employees.push({ user: task.mainAssignee, role: 'אחראי ראשי' });
      if (task.assignees) {
        task.assignees.forEach(assignee => {
          if (!task.mainAssignee || assignee._id.toString() !== task.mainAssignee._id.toString()) {
            employees.push({ user: assignee, role: 'אחראי משני' });
          }
        });
      }

      // מוסיפים מה-TaskAssigneeDetails
      if (task.assigneeDetails) {
        task.assigneeDetails.forEach(detail => {
          employees.push({ user: detail.user, role: 'משויך פרטני', statusOverride: detail.status });
        });
      }

      // לכל עובד
      employees.forEach(emp => {
        if (emp.user.role === 'מנהל') return;

        const empId = emp.user._id.toString();
        if (!tasksByEmployee[empId]) {
          tasksByEmployee[empId] = {
            employee: {
              id: emp.user._id,
              name: `${emp.user.firstName} ${emp.user.lastName}`,
              userName: emp.user.userName,
              role: emp.role
            },
            tasks: [],
            summary: {
              total: 0,
              totalRegular: 0,
              totalRecurring: 0,
              byImportance: {},
              byStatus: {},
              overdue: 0,
              avgDaysOpen: 0,
              oldestOpenDays: 0
            }
          };
        }

        // עדכון סטטוס לפי notes של אותו עובד בלבד
        let effectiveStatus = emp.statusOverride || task.status;
        if (task.notes && task.notes.length > 0) {
          const userNotes = task.notes.filter(n => n.user && n.user._id.toString() === emp.user._id.toString());
          if (userNotes.length > 0) {
            userNotes.sort((a, b) => new Date(b.date) - new Date(a.date));
            effectiveStatus = userNotes[0].status;
          }
        }

        // הוספת המשימה לדוח ללא סינון מוקדם
        if (!tasksByEmployee[empId].tasks.some(t => t._id.toString() === task._id.toString())) {
          tasksByEmployee[empId].tasks.push({ ...task, employeeRole: emp.role, status: effectiveStatus });
          tasksByEmployee[empId].summary.total++;
          if (task.taskType === 'רגילה') tasksByEmployee[empId].summary.totalRegular++;
          else tasksByEmployee[empId].summary.totalRecurring++;

          tasksByEmployee[empId].summary.byImportance[task.importance] =
            (tasksByEmployee[empId].summary.byImportance[task.importance] || 0) + 1;

          tasksByEmployee[empId].summary.byStatus[effectiveStatus] =
            (tasksByEmployee[empId].summary.byStatus[effectiveStatus] || 0) + 1;

          if (task.finalDeadline) {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const taskDate = new Date(task.finalDeadline); taskDate.setHours(0, 0, 0, 0);
            if (taskDate < today) tasksByEmployee[empId].summary.overdue++;
          }
        }
      });
    }

    // חישוב ממוצעים
    Object.values(tasksByEmployee).forEach(empData => {
      const daysArr = empData.tasks.map(t => t.daysOpen || 0);
      if (daysArr.length > 0) {
        const sum = daysArr.reduce((a, b) => a + b, 0);
        empData.summary.avgDaysOpen = Math.round(sum / daysArr.length);
        empData.summary.oldestOpenDays = Math.max(...daysArr);
      }
    });

    let result = Object.values(tasksByEmployee);
    if (employeeId) {
      result = result.filter(emp => emp.employee.id.toString() === employeeId);
    }

    res.json({
      success: true,
      data: result,
      totalTasks: allTasks.length,
      appliedFilters: req.query
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// 2. דוח משימות לפי אחראים ראשיים ומשניים - מעודכן
export const getTasksByResponsibility = async (req, res) => {
  try {
    const { responsibilityType = 'all' } = req.query;
    const userId = req.user.id;
    saveUserFilter(userId, 'tasksByResponsibility', req.query);

    const { employeeId, ...filterParams } = req.query;
    let baseFilter = buildTaskFilter(filterParams);

    // המרת מזהי Mongo בתוך ה-filter כמו שעשית בקוד הקודם
    if (baseFilter.organization) {
      baseFilter.organization = new mongoose.Types.ObjectId(baseFilter.organization);
    }
    if (baseFilter.$or) {
      baseFilter.$or = baseFilter.$or.map(condition => {
        const newCondition = { ...condition };
        Object.keys(newCondition).forEach(key => {
          if (['creator', 'mainAssignee'].includes(key)) {
            if (mongoose.isValidObjectId(newCondition[key])) {
              newCondition[key] = new mongoose.Types.ObjectId(newCondition[key]);
            }
          }
          if (key === 'assignees' && newCondition[key].$in) {
            newCondition[key].$in = newCondition[key].$in.map(id => new mongoose.Types.ObjectId(id));
          }
        });
        return newCondition;
      });
    }

    // --- שליפה ראשונית של משימות רגילות וקבועות (עם lookups) ---
    const pipeline = [
      { $match: baseFilter },
      {
        $lookup: {
          from: 'users',
          localField: 'mainAssignee',
          foreignField: '_id',
          as: 'mainAssigneeData'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'assignees',
          foreignField: '_id',
          as: 'assigneesData'
        }
      },
      {
        $lookup: {
          from: 'associations',
          localField: 'organization',
          foreignField: '_id',
          as: 'organizationData'
        }
      }
    ];

    const regularTasks = await Task.aggregate(pipeline);
    const recurringTasksRaw = await RecurringTask.aggregate([
      ...pipeline,
      // נחזור גם עם ה־notes (ולכן נקבל גם noteUsersData אם נרצה)
      {
        $lookup: {
          from: 'users',
          localField: 'notes.user',
          foreignField: '_id',
          as: 'noteUsersData'
        }
      }
    ]);

    // --- שליפת TaskAssigneeDetails לכל המשימות (רגילות + קבועות) ---
    const regularIds = regularTasks.map(t => t._id).filter(Boolean);
    const recurringIds = recurringTasksRaw.map(t => t._id).filter(Boolean);

    const detailsQueryOr = [];
    if (regularIds.length) detailsQueryOr.push({ taskId: { $in: regularIds }, taskModel: 'Task' });
    if (recurringIds.length) detailsQueryOr.push({ taskId: { $in: recurringIds }, taskModel: 'RecurringTask' });

    const allAssigneeDetails = detailsQueryOr.length
      ? await TaskAssigneeDetails.find({ $or: detailsQueryOr }).lean()
      : [];

    // ממפה: detailsByTask[taskIdStr] = { userIdStr: detailObj, ... }
    const detailsByTask = {};
    allAssigneeDetails.forEach(d => {
      const k = String(d.taskId);
      detailsByTask[k] = detailsByTask[k] || {};
      detailsByTask[k][String(d.user)] = d;
    });

    // --- עיבוד משימות קבועות: קיבוץ notes לפי תאריך (occurrence) ולא יצירת כניסה לכל note יחיד ---
    const expandedRecurringTasks = []; // פה נכניס occurrence מאוגדן לכל תאריך שבו יש notes (או fallback ל-task עצמו אם אין notes)
    for (const rtask of recurringTasksRaw) {
      const taskIdStr = String(rtask._id);
      const notes = Array.isArray(rtask.notes) ? rtask.notes : [];

      if (notes.length === 0) {
        // אין notes כלל — נשמר כאותו recurring template (כמו בקוד המקורי)
        expandedRecurringTasks.push({
          ...rtask,
          taskType: 'קבועה',
          noteStatus: rtask.status,
          noteDate: null,
          isFromNote: false
        });
        continue;
      }

      // קיבוץ לפי יום (YYYY-MM-DD)
      const notesByDay = {};
      notes.forEach(n => {
        const dayKey = new Date(n.date).toISOString().slice(0, 10); // YYYY-MM-DD
        if (!notesByDay[dayKey]) notesByDay[dayKey] = [];
        notesByDay[dayKey].push(n);
      });

      // לכל יום — צרו occurrence אחד שבו יש את כל ה־notes של אותו יום
      for (const [dayKey, notesArr] of Object.entries(notesByDay)) {
        // למשתמשים שיש כמה הערות באותו יום — קחו את העדכון האחרון של אותו משתמש
        const lastNoteByUser = {};
        notesArr.forEach(n => {
          const uid = String(n.user);
          if (!lastNoteByUser[uid]) lastNoteByUser[uid] = n;
          else {
            // נשווה תאריכים ונבחר את החדש ביותר
            if (new Date(n.date) > new Date(lastNoteByUser[uid].date)) lastNoteByUser[uid] = n;
          }
        });

        // יצירת מפת notes עבור occurrence (userId -> note)
        const occurrenceNotesMap = {};
        Object.entries(lastNoteByUser).forEach(([uid, note]) => {
          occurrenceNotesMap[uid] = note;
        });

        // helper: compute overall occurrence status לפי הכללים שהגדרת
        const computeOccurrenceOverallStatus = (taskObj, notesMap, detailsMapForTask) => {
          // mainAssignee id
          const mainIdStr = taskObj.mainAssigneeData && taskObj.mainAssigneeData[0]
            ? String(taskObj.mainAssigneeData[0]._id)
            : (taskObj.mainAssignee ? String(taskObj.mainAssignee) : null);

          // מציאת סטטוס אפקטיבי של משתמש (details -> then note -> fallback ל־taskObj.status)
          const effectiveStatusForUser = (userIdStr) => {
            if (!userIdStr) return taskObj.status || null;
            if (detailsMapForTask && detailsMapForTask[userIdStr] && detailsMapForTask[userIdStr].status) {
              return detailsMapForTask[userIdStr].status;
            }
            if (notesMap && notesMap[userIdStr] && notesMap[userIdStr].status) {
              return notesMap[userIdStr].status;
            }
            return taskObj.status || null;
          };

          // בדיקה: האם main סיים?
          if (mainIdStr) {
            const mainStatus = effectiveStatusForUser(mainIdStr);
            if (mainStatus === 'הושלם') return 'הושלם';
          }

          // בדיקה: האם היוצר סימן הושלם (אם יש note של היוצר לאותו יום)
          const creatorIdStr = taskObj.creator ? String(taskObj.creator) : null;
          if (creatorIdStr && notesMap && notesMap[creatorIdStr] && notesMap[creatorIdStr].status === 'הושלם') {
            return 'הושלם';
          }

          // אחרת נבדוק משניים: נדרוש שיש סטטוס לכל משני (details או note) ואז כולם 'הושלם'
          const assigneesArr = taskObj.assigneesData && taskObj.assigneesData.length
            ? taskObj.assigneesData.map(a => String(a._id))
            : (Array.isArray(taskObj.assignees) ? taskObj.assignees.map(a => String(a)) : []);

          // ניקח רק משניים (לא הראשי אם קיים)
          const secondaryIds = assigneesArr.filter(aid => aid !== mainIdStr);

          if (secondaryIds.length === 0) {
            // אין משניים — נחזיר הסטטוס הכללי של התבנית
            return taskObj.status || 'לביצוע';
          }

          let allHaveStatus = true;
          let allCompleted = true;
          for (const sid of secondaryIds) {
            const hasDetail = detailsMapForTask && detailsMapForTask[sid];
            const hasNote = notesMap && notesMap[sid];
            if (!hasDetail && !hasNote) {
              allHaveStatus = false;
              allCompleted = false;
              break;
            }
            const st = effectiveStatusForUser(sid);
            if (st !== 'הושלם') {
              allCompleted = false;
            }
          }

          if (allHaveStatus && allCompleted) return 'הושלם';

          // אחרת — לא ניתן לטעון שהושלם לפי כללי המשניים, נחזיר כברירת מחדל את סטטוס התבנית
          return taskObj.status || 'לביצוע';
        };

        const overallStatus = computeOccurrenceOverallStatus(rtask, occurrenceNotesMap, detailsByTask[taskIdStr]);

        // דוח של occurrence — שמרתי את השדות הקיימים + שדה noteDate/noteStatus כפי שהיה אצלך
        expandedRecurringTasks.push({
          ...rtask,
          taskType: 'קבועה',
          noteStatus: overallStatus,
          noteDate: new Date(dayKey).toISOString(), // תאריך ה-occurrence
          isFromNote: true,
          // שדה נוסף שימושי לשימוש פנימי (לא משנה את המבנה העיקרי)
          _occurrenceNotesMap: occurrenceNotesMap,
          _taskAssigneeDetailsMap: detailsByTask[taskIdStr] || {}
        });
      } // end for each dayKey
    } // end for each recurring task

    // --- איחוד כל המשימות (רגילות + occurrences משודרגות) ---
    const allTasks = [
      ...regularTasks.map(t => ({ ...t, taskType: 'רגילה', _taskAssigneeDetailsMap: detailsByTask[String(t._id)] || {} })),
      ...expandedRecurringTasks
    ];

    // --- בניית הדוח לפי אחראים (main/secondary) עם הסטטוסים המותאמים לעובד ---
    const responsibilityReport = {
      mainResponsible: {},
      secondaryResponsible: {},
      summary: {
        totalTasks: allTasks.length,
        mainAssignees: new Set(),
        secondaryAssignees: new Set(),
        byImportance: {},
        byStatus: {}
      }
    };

    // עזר לחישוב סטטוס אפקטיבי לעובד בכל משימה/occurrence
    const getEffectiveStatusForUser = (taskObj, userIdStr) => {
      const taskIdStr = String(taskObj._id);
      const detailsMap = taskObj._taskAssigneeDetailsMap || (detailsByTask[taskIdStr] || {});
      // 1) TaskAssigneeDetails
      if (detailsMap && detailsMap[userIdStr] && detailsMap[userIdStr].status) return detailsMap[userIdStr].status;
      // 2) occurrence notes (אם קיימים)
      const notesMap = taskObj._occurrenceNotesMap;
      if (notesMap && notesMap[userIdStr] && notesMap[userIdStr].status) return notesMap[userIdStr].status;
      // 3) fallback לסטטוס הכללי בשדה של המשימה/תבנית
      return taskObj.status || (taskObj.noteStatus || 'לביצוע');
    };

    // עזר: חישוב overall status של רשומה (רגילה/occurrence) לפי הכללים (השתמשנו גם קודם כשיצרנו occurrences)
    const computeOverallStatusForTaskRecord = (taskObj) => {
      // אם ישנו noteStatus (ל־occurrence) השתמש בו כחוזק ראשון
      if (taskObj.isFromNote) {
        // כבר חושב כ־noteStatus בעת יצירה, נחזיר אותו
        return taskObj.noteStatus || taskObj.status || 'לביצוע';
      }
      // אחרת לרוב משימה רגילה – ניישם את אותו כלל: main או כל המשניים
      const mainIdStr = taskObj.mainAssigneeData && taskObj.mainAssigneeData[0]
        ? String(taskObj.mainAssigneeData[0]._id)
        : (taskObj.mainAssignee ? String(taskObj.mainAssignee) : null);

      if (mainIdStr) {
        const mainStatus = getEffectiveStatusForUser(taskObj, mainIdStr);
        if (mainStatus === 'הושלם') return 'הושלם';
      }

      // משניים
      const assigneesArr = taskObj.assigneesData && taskObj.assigneesData.length
        ? taskObj.assigneesData.map(a => String(a._id))
        : (Array.isArray(taskObj.assignees) ? taskObj.assignees.map(a => String(a)) : []);

      const secondaryIds = assigneesArr.filter(aid => aid !== mainIdStr);
      if (secondaryIds.length === 0) return taskObj.status || 'לביצוע';

      const detailsMap = taskObj._taskAssigneeDetailsMap || {};
      const notesMap = taskObj._occurrenceNotesMap || {};

      let allHave = true;
      let allCompl = true;
      for (const sid of secondaryIds) {
        const hasDetail = detailsMap && detailsMap[sid];
        const hasNote = notesMap && notesMap[sid];
        if (!hasDetail && !hasNote) {
          allHave = false;
          allCompl = false;
          break;
        }
        const eff = getEffectiveStatusForUser(taskObj, sid);
        if (eff !== 'הושלם') allCompl = false;
      }
      if (allHave && allCompl) return 'הושלם';

      return taskObj.status || 'לביצוע';
    };

    // עובר על כל המשימות וממלא את ה-dictionaries של אחראים
    allTasks.forEach(task => {
      const overallStatus = computeOverallStatusForTaskRecord(task);

      // פרטי mainAssignee
      const mainAssignee = task.mainAssigneeData && task.mainAssigneeData[0] ? task.mainAssigneeData[0] : null;
      const assignees = Array.isArray(task.assigneesData) ? task.assigneesData : (Array.isArray(task.assignees) ? task.assignees.map(id => ({ _id: id })) : []);

      // --- MAIN responsible ---
      if (mainAssignee && (!employeeId || String(mainAssignee._id) === String(employeeId))) {
        const mainKey = String(mainAssignee._id);
        if (!responsibilityReport.mainResponsible[mainKey]) {
          responsibilityReport.mainResponsible[mainKey] = {
            employee: {
              id: mainAssignee._id,
              name: `${mainAssignee.firstName || ''} ${mainAssignee.lastName || ''}`.trim(),
              userName: mainAssignee.userName || ''
            },
            tasks: [],
            summary: { total: 0, byImportance: {}, byStatus: {} }
          };
        }

        responsibilityReport.mainResponsible[mainKey].tasks.push(task);
        responsibilityReport.mainResponsible[mainKey].summary.total++;
        responsibilityReport.summary.mainAssignees.add(mainKey);

        // חשבון סטטוס ספציפי לעובד (main) — משתמשים ב־effective status עבורו
        const effMain = getEffectiveStatusForUser(task, mainKey);
        responsibilityReport.mainResponsible[mainKey].summary.byStatus[effMain] =
          (responsibilityReport.mainResponsible[mainKey].summary.byStatus[effMain] || 0) + 1;

        responsibilityReport.mainResponsible[mainKey].summary.byImportance[task.importance] =
          (responsibilityReport.mainResponsible[mainKey].summary.byImportance[task.importance] || 0) + 1;
      }

      // --- SECONDARY responsible ---
      assignees.forEach(assignee => {
        const assigneeIdStr = String(assignee._id ? assignee._id : assignee);
        // דילוג על הראשי
        const mainIdStr = task.mainAssigneeData && task.mainAssigneeData[0]
          ? String(task.mainAssigneeData[0]._id)
          : (task.mainAssignee ? String(task.mainAssignee) : null);
        if (assigneeIdStr === mainIdStr) return;

        if (!employeeId || assigneeIdStr === String(employeeId)) {
          const secondaryKey = assigneeIdStr;
          if (!responsibilityReport.secondaryResponsible[secondaryKey]) {
            responsibilityReport.secondaryResponsible[secondaryKey] = {
              employee: {
                id: assignee._id || assignee,
                name: `${assignee.firstName || ''} ${assignee.lastName || ''}`.trim() || '',
                userName: assignee.userName || ''
              },
              tasks: [],
              summary: { total: 0, byImportance: {}, byStatus: {} }
            };
          }

          responsibilityReport.secondaryResponsible[secondaryKey].tasks.push(task);
          responsibilityReport.secondaryResponsible[secondaryKey].summary.total++;
          responsibilityReport.summary.secondaryAssignees.add(secondaryKey);

          const effSec = getEffectiveStatusForUser(task, secondaryKey);
          responsibilityReport.secondaryResponsible[secondaryKey].summary.byStatus[effSec] =
            (responsibilityReport.secondaryResponsible[secondaryKey].summary.byStatus[effSec] || 0) + 1;

          responsibilityReport.secondaryResponsible[secondaryKey].summary.byImportance[task.importance] =
            (responsibilityReport.secondaryResponsible[secondaryKey].summary.byImportance[task.importance] || 0) + 1;
        }
      });

      // --- סיכום כללי (byImportance/byStatus) לפי overallStatus ---
      responsibilityReport.summary.byImportance[task.importance] =
        (responsibilityReport.summary.byImportance[task.importance] || 0) + 1;
      responsibilityReport.summary.byStatus[overallStatus] =
        (responsibilityReport.summary.byStatus[overallStatus] || 0) + 1;
    });

    // --- סינון לפי סוג אחריות אם נדרש ---
    let filteredResponse = responsibilityReport;
    if (responsibilityType === 'main') {
      filteredResponse = {
        mainResponsible: responsibilityReport.mainResponsible,
        summary: {
          ...responsibilityReport.summary,
          secondaryResponsible: {}
        }
      };
    } else if (responsibilityType === 'secondary') {
      filteredResponse = {
        secondaryResponsible: responsibilityReport.secondaryResponsible,
        summary: {
          ...responsibilityReport.summary,
          mainResponsible: {}
        }
      };
    }

    // החזרת התוצאה (שמעניקה בדיוק את המבנה שהיית מצפה לו)
    return res.json({
      success: true,
      data: filteredResponse,
      appliedFilters: req.query
    });

  } catch (err) {
    console.error('getTasksByResponsibility error:', err);
    const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    res.status(statusCode).json({ message: err.message || 'שגיאה בשליפת דוח אחראים' });
  }
};

// 3. משימות חורגות מיעד
export const getOverdueTasks = async (req, res) => {
  try {
    const {
      daysOverdue = 1,
      includeNoDeadline = false
    } = req.query;

    const userId = req.user.id;
    saveUserFilter(userId, 'overdueTasks', req.query);

    let baseFilter = buildTaskFilter(req.query);

    if (baseFilter.status) {
      if (Array.isArray(baseFilter.status.$in)) {
        baseFilter.status.$in = baseFilter.status.$in.filter(s => !['הושלם', 'בוטלה'].includes(s));
      } else if (baseFilter.status !== 'הושלם' && baseFilter.status !== 'בוטלה') {
        baseFilter.status = { $nin: ['הושלם', 'בוטלה'], $eq: baseFilter.status };
      } else {
        return res.json({ success: true, data: [], statistics: {}, appliedFilters: req.query });
      }
    } else {
      baseFilter.status = { $nin: ['הושלם', 'בוטלה'] };
    }

    const now = new Date();
    const overdueDate = new Date(now.getTime() - (daysOverdue * 24 * 60 * 60 * 1000));

    if (includeNoDeadline === 'true') {
      const existingOr = baseFilter.$or;
      baseFilter.$and = [
        existingOr ? { $or: existingOr } : {},
        {
          $or: [
            { finalDeadline: { $lt: overdueDate } },
            { finalDeadline: { $exists: false } },
            { finalDeadline: null }
          ]
        }
      ].filter(Boolean);
      delete baseFilter.$or;
    } else {
      baseFilter.finalDeadline = { $lt: overdueDate };
    }

    // משימות רגילות באיחור
    const overdueTasks = await Task.find(baseFilter)
      .populate('creator', 'firstName lastName userName')
      .populate('mainAssignee', 'firstName lastName userName')
      .populate('assignees', 'firstName lastName userName')
      .populate('organization', 'name')
      .sort({ finalDeadline: 1 });

    // משימות קבועות באיחור
    const overdueRecurringTasks = await RecurringTask.find(baseFilter)
      .populate('creator', 'firstName lastName userName')
      .populate('mainAssignee', 'firstName lastName userName')
      .populate('assignees', 'firstName lastName userName')
      .populate('organization', 'name')
      .populate('notes.user', 'firstName lastName userName')
      .sort({ finalDeadline: 1 });

    // המרת משימות קבועות לביצועים נפרדים - רק אלה שלא הושלמו
    const expandedOverdueRecurringTasks = expandRecurringTasks(overdueRecurringTasks)
      .filter(task => {
        const taskStatus = task.isFromNote ? task.noteStatus : task.status;
        return !['הושלם', 'בוטלה'].includes(taskStatus);
      });

    // שילוב המשימות
    const allOverdueTasks = [
      ...overdueTasks.map(task => ({ ...task.toObject(), taskType: 'רגילה', isFromNote: false })),
      ...expandedOverdueRecurringTasks
    ];

    // חישוב מידע נוסף לכל משימה
    const enrichedTasks = await Promise.all(allOverdueTasks.map(async (task) => {
      const assigneeDetails = await getAssigneeDetails(task._id, task.taskType === 'רגילה' ? 'Task' : 'RecurringTask');

      let daysOverdueCount = 0;
      if (task.finalDeadline) {
        daysOverdueCount = Math.floor((now - new Date(task.finalDeadline)) / (1000 * 60 * 60 * 24));
      }

      return {
        ...task,
        daysOverdue: daysOverdueCount,
        daysOpen: task.daysOpen || 0,
        assigneeDetails,
        severity: daysOverdueCount > 30 ? 'קריטי' : daysOverdueCount > 7 ? 'חמור' : 'קל'
      };
    }));

    // סטטיסטיקות
    const statistics = {
      total: enrichedTasks.length,
      bySeverity: {
        'קריטי': enrichedTasks.filter(t => t.severity === 'קריטי').length,
        'חמור': enrichedTasks.filter(t => t.severity === 'חמור').length,
        'קל': enrichedTasks.filter(t => t.severity === 'קל').length
      },
      byImportance: {},
      byEmployee: {},
      averageDaysOverdue: 0
    };

    let totalDaysOverdue = 0;
    enrichedTasks.forEach(task => {
      statistics.byImportance[task.importance] =
        (statistics.byImportance[task.importance] || 0) + 1;

      const mainAssigneeName = `${task.mainAssignee.firstName} ${task.mainAssignee.lastName}`;
      statistics.byEmployee[mainAssigneeName] =
        (statistics.byEmployee[mainAssigneeName] || 0) + 1;

      totalDaysOverdue += task.daysOverdue;
    });

    statistics.averageDaysOverdue = enrichedTasks.length > 0 ?
      Math.round(totalDaysOverdue / enrichedTasks.length) : 0;

    res.json({
      success: true,
      data: enrichedTasks,
      statistics,
      appliedFilters: req.query
    });

  } catch (error) {
    console.error('Error in getOverdueTasks:', error);
    res.status(500).json({ success: false, message: 'שגיאה בשליפת דוח משימות באיחור' });
  }
};
// 4. סיכום משימות לפי תקופה - מעודכן

// קונסטנטות
const ISRAEL_TIMEZONE = "Asia/Jerusalem";
const MAX_DAYS_LIMITS = { week: 70, month: 365, year: 3650 };
const MAX_ITERATIONS = 1000;
const MAX_DATES_PER_TASK = 500;

// פונקציות עזר
const getIsraeliDate = (date) => dayjs(date).tz(ISRAEL_TIMEZONE);
const getStartOfDay = (date) => getIsraeliDate(date).startOf('day');
const getEndOfDay = (date) => getIsraeliDate(date).endOf('day');

// פונקציה לקביעת טווח תאריכים
const getPeriodRange = (period) => {
  const now = getIsraeliDate();
  let periodStart;
  let maxDays = MAX_DAYS_LIMITS.month;

  switch (period) {
    case 'week':
      periodStart = now.subtract(10, 'week').startOf('day');
      maxDays = MAX_DAYS_LIMITS.week;
      break;
    case 'year':
      periodStart = now.subtract(10, 'year').startOf('year');
      maxDays = MAX_DAYS_LIMITS.year;
      break;
    case 'month':
    default:
      periodStart = now.subtract(12, 'month').startOf('month');
      maxDays = MAX_DAYS_LIMITS.month;
  }

  // וידוא שלא נעבור על מגבלת הזמן
  const daysDiff = now.diff(periodStart, 'day');
  if (daysDiff > maxDays) {
    periodStart = now.subtract(maxDays, 'day').startOf('day');
  }

  return { 
    start: periodStart.toDate(), 
    end: now.endOf('day').toDate() 
  };
};

// פונקציה לבדיקת השלמת משימה קבועה
const isRecurringTaskCompleted = (task, targetDate) => {
  try {
    if (!task.notes?.length) return false;

    const targetDay = getStartOfDay(targetDate);
    
    // מציאת הערות של אותו יום
    const dayNotes = task.notes.filter(note => 
      note.date && getStartOfDay(note.date).isSame(targetDay, 'day')
    );

    if (!dayNotes.length) return false;

    // קבלת אחראים
    const mainAssigneeId = task.mainAssignee?._id?.toString();
    const assigneeIds = task.assignees
      ?.map(a => a._id.toString())
      .filter(id => id !== mainAssigneeId) || [];

    // מיון הערות לפי תאריך
    const sortedNotes = dayNotes
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // סטטוס אחרון לכל משתמש
    const lastStatusByUser = {};
    sortedNotes.forEach(note => {
      if (note.user) {
        const userId = (typeof note.user === 'object' ? note.user._id : note.user).toString();
        lastStatusByUser[userId] = note.status;
      }
    });

    // מי השלים
    const completedUsers = Object.keys(lastStatusByUser)
      .filter(userId => lastStatusByUser[userId] === 'הושלם');

    if (!completedUsers.length) return false;

    // בדיקת מנהל
    const managerCompleted = sortedNotes.some(note =>
      note.status === 'הושלם' && note.user?.role === 'מנהל'
    );
    if (managerCompleted) return true;

    // בדיקת אחראי ראשי
    if (mainAssigneeId && completedUsers.includes(mainAssigneeId)) return true;

    // בדיקת כל האחראים השניים
    return assigneeIds.length > 0 && 
           assigneeIds.every(id => completedUsers.includes(id));

  } catch (error) {
    console.error(`Error checking task completion for ${task.taskId}:`, error.message);
    return false;
  }
};

// פונקציה ליצירת תאריכים אפשריים - מופשטת
const generateRecurringDates = (task, startDate, endDate) => {
  const dates = [];
  const start = getStartOfDay(startDate);
  const end = getEndOfDay(endDate);
  let iterationCount = 0;

  const addDateIfValid = (date) => {
    if (date.isBetween(start, end, null, '[]') && dates.length < MAX_DATES_PER_TASK) {
      dates.push(date.toDate());
    }
  };

  try {
    switch (task.frequencyType) {
      case 'יומי':
        let current = start;
        while (current.isSameOrBefore(end) && iterationCount < MAX_ITERATIONS) {
          iterationCount++;
          
          if (task.frequencyDetails?.includingFriday !== false || current.day() !== 5) {
            addDateIfValid(current);
          }
          current = current.add(1, 'day');
        }
        break;

      case 'יומי פרטני':
        const allowedDays = task.frequencyDetails?.days || [];
        if (allowedDays.length) {
          let currentDay = start;
          while (currentDay.isSameOrBefore(end) && iterationCount < MAX_ITERATIONS) {
            iterationCount++;
            
            if (allowedDays.includes(currentDay.day())) {
              addDateIfValid(currentDay);
            }
            currentDay = currentDay.add(1, 'day');
          }
        }
        break;

      case 'חודשי':
        const dayOfMonth = task.frequencyDetails?.dayOfMonth || 1;
        let monthCursor = start.startOf('month');
        while (monthCursor.isSameOrBefore(end, 'month') && iterationCount < MAX_ITERATIONS) {
          iterationCount++;
          
          const targetDay = Math.min(dayOfMonth, monthCursor.daysInMonth());
          const date = monthCursor.date(targetDay);
          addDateIfValid(date);
          monthCursor = monthCursor.add(1, 'month');
        }
        break;

      case 'שנתי':
        const month = Math.max(0, Math.min(11, (task.frequencyDetails?.month || 1) - 1));
        const day = Math.max(1, Math.min(31, task.frequencyDetails?.day || 1));
        let yearCursor = start.startOf('year');
        while (yearCursor.isSameOrBefore(end, 'year') && iterationCount < MAX_ITERATIONS) {
          iterationCount++;
          
          const targetDate = yearCursor.month(month);
          const finalDay = Math.min(day, targetDate.daysInMonth());
          addDateIfValid(targetDate.date(finalDay));
          yearCursor = yearCursor.add(1, 'year');
        }
        break;
    }

    if (iterationCount >= MAX_ITERATIONS) {
      console.warn(`Max iterations reached for task ${task.taskId}`);
    }

  } catch (error) {
    console.error(`Error generating dates for task ${task.taskId}:`, error.message);
  }

  return dates;
};

// פונקציה לחישוב מפתח תקופה
const getPeriodKey = (date, periodType) => {
  const israeliDate = getIsraeliDate(date);
  
  switch (periodType) {
    case 'week':
      return `${israeliDate.isoWeekYear()}-W${israeliDate.isoWeek().toString().padStart(2, '0')}`;
    case 'year':
      return israeliDate.year().toString();
    case 'month':
    default:
      return israeliDate.format('YYYY-MM');
  }
};

// פונקציה ליצירת סיכום
const createSummaryData = (completedTasks, period) => {
  const summaryData = {};

  completedTasks.forEach(task => {
    if (!task.effectiveDate || isNaN(task.effectiveDate)) return;

    const periodKey = getPeriodKey(task.effectiveDate, period);

    if (!summaryData[periodKey]) {
      summaryData[periodKey] = {
        period: periodKey,
        completedTasks: 0,
        byImportance: {},
        byTaskType: { רגילה: 0, קבועה: 0 }
      };
    }

    const summary = summaryData[periodKey];
    summary.completedTasks++;
    summary.byImportance[task.importance] = (summary.byImportance[task.importance] || 0) + 1;
    summary.byTaskType[task.taskType]++;
  });

  return Object.values(summaryData).sort((a, b) => a.period.localeCompare(b.period));
};

// הפונקציה הראשית - מופשטת ומקוצרת
export const getTasksSummaryByPeriod = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const userId = req.user.id;

    // שמירת פילטר ובניית פילטר בסיסי
    if (typeof saveUserFilter === 'function') {
      saveUserFilter(userId, 'tasksSummary', req.query);
    }

    let baseFilter = {};
    if (typeof buildTaskFilter === 'function') {
      baseFilter = buildTaskFilter(req.query);
    }

    // המרת IDs ל-ObjectId (פונקציה נפרדת)
    const convertIdsInFilter = (filter) => {
      const converted = { ...filter };
      
      if (converted.organization) {
        converted.organization = new mongoose.Types.ObjectId(converted.organization);
      }
      
      if (converted.$or) {
        converted.$or = converted.$or.map(cond => {
          const newCond = { ...cond };
          Object.keys(newCond).forEach(key => {
            if (['creator', 'mainAssignee'].includes(key)) {
              newCond[key] = new mongoose.Types.ObjectId(newCond[key]);
            }
            if (key === 'assignees' && newCond[key].$in) {
              newCond[key].$in = newCond[key].$in.map(id => new mongoose.Types.ObjectId(id));
            }
          });
          return newCond;
        });
      }
      
      return converted;
    };

    const regularFilter = convertIdsInFilter(baseFilter);
    const recurringFilter = convertIdsInFilter(baseFilter);

    // קביעת טווח תאריכים
    const { start: periodStart, end: periodEnd } = getPeriodRange(period);

    // הוספת פילטר תאריכים למשימות רגילות
    regularFilter.createdAt = regularFilter.createdAt || { 
      $gte: periodStart, 
      $lte: periodEnd 
    };

    // שליפת נתונים במקביל
    const [regularTasks, recurringTasks] = await Promise.all([
      Task.find({ ...regularFilter, isDeleted: { $ne: true } })
        .populate('mainAssignee', 'firstName lastName')
        .populate('assignees', 'firstName lastName'),
      
      RecurringTask.find({ 
        ...recurringFilter, 
        isDeleted: { $ne: true } 
      })
        .populate('notes.user', 'firstName lastName userName role')
        .populate('mainAssignee', 'firstName lastName')
        .populate('assignees', 'firstName lastName')
    ]);

    // עיבוד משימות קבועות
    const completedRecurringTasks = [];
    
    recurringTasks.forEach(task => {
      try {
        const possibleDates = generateRecurringDates(task, periodStart, periodEnd);
        
        possibleDates.forEach(date => {
          if (isRecurringTaskCompleted(task, date)) {
            completedRecurringTasks.push({
              ...task.toObject(),
              taskType: 'קבועה',
              effectiveDate: date,
              effectiveStatus: 'הושלם',
              importance: task.importance,
              originalTaskId: task.taskId || task._id,
              instanceDate: date
            });
          }
        });
      } catch (error) {
        console.error(`Error processing recurring task ${task.taskId}:`, error.message);
      }
    });

    // שילוב משימות מושלמות
    const allCompletedTasks = [
      ...regularTasks
        .filter(t => t.status === 'הושלם')
        .map(t => ({
          ...t.toObject(),
          taskType: 'רגילה',
          effectiveDate: t.createdAt,
          effectiveStatus: t.status,
          importance: t.importance
        })),
      ...completedRecurringTasks
    ];

    // יצירת סיכום
    const sortedSummary = createSummaryData(allCompletedTasks, period);

    // חישוב סטטיסטיקות כלליות
    const overallStats = {
      totalPeriods: sortedSummary.length,
      totalCompletedTasks: sortedSummary.reduce((sum, item) => sum + item.completedTasks, 0),
      totalRegularTasksCompleted: sortedSummary.reduce((sum, item) => sum + item.byTaskType.רגילה, 0),
      totalRecurringTasksCompleted: sortedSummary.reduce((sum, item) => sum + item.byTaskType.קבועה, 0),
      averageCompletedTasksPerPeriod: 0
    };

    if (overallStats.totalPeriods > 0) {
      overallStats.averageCompletedTasksPerPeriod = 
        Math.round(overallStats.totalCompletedTasks / overallStats.totalPeriods);
    }

    // סטטיסטיקות חשיבות
    const importanceStats = {};
    allCompletedTasks.forEach(task => {
      const importance = task.importance;
      importanceStats[importance] = importanceStats[importance] || { completed: 0 };
      importanceStats[importance].completed++;
    });

    res.json({
      success: true,
      data: sortedSummary,
      overallStats,
      importanceStats,
      period: {
        type: period,
        start: periodStart,
        end: periodEnd
      },
      appliedFilters: req.query,
      meta: {
        regularTasksCount: regularTasks.length,
        regularTasksCompletedCount: regularTasks.filter(t => t.status === 'הושלם').length,
        recurringTasksCount: recurringTasks.length,
        completedRecurringInstancesCount: completedRecurringTasks.length,
        generatedAt: getIsraeliDate().toISOString()
      }
    });

  } catch (error) {
    console.error('Error in getTasksSummaryByPeriod:', error);
    res.status(500).json({
      success: false,
      message: 'שגיאה בשליפת סיכום משימות',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
// export const getTasksSummaryByPeriod = async (req, res) => {
//   try {
//     const { period = 'month' } = req.query;
//     const userId = req.user.id;


//     // שמירת פילטר המשתמש
//     if (typeof saveUserFilter === 'function') {
//       saveUserFilter(userId, 'tasksSummary', req.query);
//     }

//     // בניית פילטר בסיסי
//     let baseFilter = {};
//     if (typeof buildTaskFilter === 'function') {
//       baseFilter = buildTaskFilter(req.query);
//     }

//     // יצירת פילטר נפרד למשימות קבועות
//     let recurringFilter = { ...baseFilter };

//     // המרת ids ל-ObjectId עבור משימות רגילות
//     if (baseFilter.organization) {
//       baseFilter.organization = new mongoose.Types.ObjectId(baseFilter.organization);
//     }
//     if (baseFilter.$or) {
//       baseFilter.$or = baseFilter.$or.map(cond => {
//         const newCond = { ...cond };
//         Object.keys(newCond).forEach(key => {
//           if (['creator', 'mainAssignee'].includes(key)) {
//             newCond[key] = new mongoose.Types.ObjectId(newCond[key]);
//           }
//           if (key === 'assignees' && newCond[key].$in) {
//             newCond[key].$in = newCond[key].$in.map(id => new mongoose.Types.ObjectId(id));
//           }
//         });
//         return newCond;
//       });
//     }

//     // המרת ids עבור משימות קבועות
//     if (recurringFilter.organization) {
//       recurringFilter.organization = new mongoose.Types.ObjectId(recurringFilter.organization);
//     }
//     if (recurringFilter.$or) {
//       recurringFilter.$or = recurringFilter.$or.map(cond => {
//         const newCond = { ...cond };
//         Object.keys(newCond).forEach(key => {
//           if (['creator', 'mainAssignee'].includes(key)) {
//             newCond[key] = new mongoose.Types.ObjectId(newCond[key]);
//           }
//           if (key === 'assignees' && newCond[key].$in) {
//             newCond[key].$in = newCond[key].$in.map(id => new mongoose.Types.ObjectId(id));
//           }
//         });
//         return newCond;
//       });
//     }

//     // קביעת טווח תאריכים - עם מגבלות בטיחות
//     const now = new Date();
//     let periodStart;
//     let maxDays = 365; // מגבלה מקסימלית

//     switch (period) {
//       case 'week':
//         periodStart = new Date();
//         periodStart.setDate(now.getDate() - (10 * 7)); // 10 שבועות
//         maxDays = 70;
//         break;
//       case 'month':
//         periodStart = new Date(now.getFullYear(), now.getMonth() - 11, 1); // 12 חודשים
//         maxDays = 365;
//         break;
//       case 'year':
//         periodStart = new Date(now.getFullYear() - 9, 0, 1); // 10 שנים
//         maxDays = 3650;
//         break;
//       default:
//         // ברירת מחדל - חודש
//         periodStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
//         maxDays = 365;
//     }

//     // וידוא שלא נעבור על מגבלת הזמן
//     const daysDiff = Math.abs((now - periodStart) / (1000 * 60 * 60 * 24));
//     if (daysDiff > maxDays) {
//       periodStart = new Date(now.getTime() - (maxDays * 24 * 60 * 60 * 1000));
//     }

//     // הוספת פילטר תאריכים למשימות רגילות בלבד
//     baseFilter.createdAt = baseFilter.createdAt || { $gte: periodStart, $lte: now };



//     // שליפת משימות רגילות
//     const regularTasks = await Task.find({
//       ...baseFilter,
//       isDeleted: { $ne: true }
//     }).populate('mainAssignee', 'firstName lastName')
//       .populate('assignees', 'firstName lastName');


//     // שליפת משימות קבועות - ללא פילטר תאריכים
//     let recurringTasksQuery = {
//       ...recurringFilter,
//       isDeleted: { $ne: true }
//     };
//     delete recurringTasksQuery.createdAt;

//     const recurringTasks = await RecurringTask.find(recurringTasksQuery)
//       .populate('notes.user', 'firstName lastName userName role')
//       .populate('mainAssignee', 'firstName lastName')
//       .populate('assignees', 'firstName lastName');


//     // פונקציה משופרת לבדיקת השלמת משימה קבועה ביום מסוים
//     const isRecurringTaskCompleted = (task, targetDate) => {
//       try {

//         if (!task.notes || task.notes.length === 0) {
//           return false;
//         }

//         // מציאת כל ההערות של אותו יום
//         const relevantNotes = task.notes.filter(note => {
//           if (!note.date) return false;
//           return dayjs(note.date).tz("Asia/Jerusalem").isSame(dayjs(targetDate).tz("Asia/Jerusalem"), 'day');

//         });

//         if (relevantNotes.length === 0) {
//           return false;
//         }

//         // מידע על האחראים
//         const mainAssigneeId = task.mainAssignee?._id?.toString();
//         const assigneeIds = task.assignees
//           ? task.assignees.map(a => a._id.toString()).filter(id => id !== mainAssigneeId)
//           : [];


//         // כל האחראים (ראשי + שניים) - הסרת כפילויות
//         const allAssigneeIds = [...new Set([mainAssigneeId, ...assigneeIds].filter(Boolean))];

//         // מיון ההערות לפי זמן יצירה (מהמוקדם לאחרון)
//         const sortedNotes = relevantNotes
//           .filter(note => note.date) // רק הערות עם תאריך תקין
//           .sort((a, b) => new Date(a.date) - new Date(b.date));

//         // מציאת הסטטוס האחרון של כל משתמש באותו יום
//         const lastStatusByUser = {};
//         sortedNotes.forEach(note => {
//           if (note.user) {
//             const userId = typeof note.user === 'object' && note.user._id
//               ? note.user._id.toString()
//               : note.user.toString();
//             lastStatusByUser[userId] = note.status;
//           }
//         });

//         // מי השלים (לפי הסטטוס האחרון שלו)
//         const completedByUsers = Object.keys(lastStatusByUser).filter(
//           userId => lastStatusByUser[userId] === 'הושלם'
//         );

//         if (completedByUsers.length === 0) {
//           return false;
//         }
        

//         // בדיקת התנאים לפי סדר עדיפויות
//         // תנאי נוסף: אם מנהל השלים היום
//         const managerCompleted = sortedNotes.some(note => {
//           const isSameDay = dayjs(note.date).tz("Asia/Jerusalem").isSame(dayjs(targetDate).tz("Asia/Jerusalem"), 'day');

//           return (
//             isSameDay &&
//             note.status === 'הושלם' &&
//             note.user?.role === 'מנהל'
//           );
//         });

//         if (managerCompleted) {
//           return true;
//         }


//         // תנאי 1: האחראי הראשי השלים (סטטוס אחרון)
//         if (mainAssigneeId && completedByUsers.includes(mainAssigneeId)) {
//           return true;
//         }

//         // תנאי 2: כל האחראים השניים השלימו (אם יש כאלה)
//         if (assigneeIds.length > 0) {
//           const allSecondaryCompleted = assigneeIds.every(assigneeId =>
//             completedByUsers.includes(assigneeId)
//           );

//           if (allSecondaryCompleted) {
//             return true;
//           }
//         }


//       }

//       catch (error) {
//         console.error(`Error checking task completion for ${task.taskId || task._id}:`, error.message);
//         return false;
//       }
//     };

//     // פונקציה ליצירת תאריכים אפשריים למשימה קבועה - עם הגנות
//     const generatePossibleDates = (task, startDate, endDate) => {
//       const dates = [];
//       const taskStart = dayjs(startDate).tz("Asia/Jerusalem").startOf('day');
//       const taskEnd = dayjs(endDate).tz("Asia/Jerusalem").endOf('day');

//       // הגנה מפני טווחי זמן גדולים מדי
//       const maxIterations = 1000; // מקסימום 1000 תאריכים לכל משימה
//       let iterationCount = 0;

//       try {
//         switch (task.frequencyType) {
//           case 'יומי':
//             let current = taskStart;
//             while ((current.isBefore(taskEnd) || current.isSame(taskEnd, 'day')) && iterationCount < maxIterations) {
//               iterationCount++;

//               if (task.frequencyDetails?.includingFriday === false && current.day() === 5) {
//                 current = current.add(1, 'day');
//                 continue;
//               }
//               dates.push(current.toDate());
//               current = current.add(1, 'day');
//             }
//             break;

//           case 'יומי פרטני':
//             const days = task.frequencyDetails?.days || [];
//             if (!Array.isArray(days) || days.length === 0) {
//               break;
//             }

//             let currentDay = taskStart;
//             while ((currentDay.isBefore(taskEnd) || currentDay.isSame(taskEnd, 'day')) && iterationCount < maxIterations) {
//               iterationCount++;

//               if (days.includes(currentDay.day())) {
//                 dates.push(currentDay.toDate());
//               }
//               currentDay = currentDay.add(1, 'day');
//             }
//             break;

//           case 'חודשי':
//             const dayOfMonth = task.frequencyDetails?.dayOfMonth || 1;
//             let monthCursor = taskStart.startOf('month');
//             while ((monthCursor.isBefore(taskEnd) || monthCursor.isSame(taskEnd, 'month')) && iterationCount < maxIterations) {
//               iterationCount++;

//               const targetDay = Math.min(dayOfMonth, monthCursor.daysInMonth());
//               const date = monthCursor.date(targetDay);
//               if (date.isBetween(taskStart, taskEnd, null, '[]')) {
//                 dates.push(date.toDate());
//               }
//               monthCursor = monthCursor.add(1, 'month');
//             }
//             break;

//           case 'שנתי':
//             const month = Math.max(0, Math.min(11, (task.frequencyDetails?.month || 1) - 1));
//             const day = Math.max(1, Math.min(31, task.frequencyDetails?.day || 1));
//             let yearCursor = taskStart.startOf('year');
//             while ((yearCursor.isBefore(taskEnd) || yearCursor.isSame(taskEnd, 'year')) && iterationCount < maxIterations) {
//               iterationCount++;

//               const date = yearCursor.month(month).date(Math.min(day, yearCursor.month(month).daysInMonth()));
//               if (date.isBetween(taskStart, taskEnd, null, '[]')) {
//                 dates.push(date.toDate());
//               }
//               yearCursor = yearCursor.add(1, 'year');
//             }
//             break;

//           default:
//         }

//         if (iterationCount >= maxIterations) {
//           console.log(`Warning: Hit max iterations for task ${task.taskId}, generated ${dates.length} dates`);
//         }

//       } catch (error) {
//         console.error(`Error generating dates for task ${task.taskId}:`, error.message);
//       }

//       return dates;
//     };

//     // יצירת מופעים של משימות קבועות שהושלמו בלבד
//     const completedRecurringTasks = [];


//     recurringTasks.forEach((task, taskIndex) => {
//       try {

//         // יצירת כל התאריכים האפשריים עבור המשימה
//         const possibleDates = generatePossibleDates(task, periodStart, now);

//         if (possibleDates.length > 500) {
//           possibleDates.splice(500); // לקחת רק את 500 הראשונים
//         }

//         // בדיקה אילו מהתאריכים בפועל הושלמו
//         possibleDates.forEach((date, dateIndex) => {
//           const isCompleted = isRecurringTaskCompleted(task, date);

//           if (isCompleted) {
//             completedRecurringTasks.push({
//               ...task.toObject(),
//               taskType: 'קבועה',
//               effectiveDate: date,
//               effectiveStatus: 'הושלם',
//               importance: task.importance,
//               originalTaskId: task.taskId || task._id,
//               instanceDate: date
//             });
//           }
//         });

//       } catch (error) {
//         console.error(`Error processing recurring task ${task.taskId}:`, error.message);
//       }
//     });


//     // שילוב כל המשימות המושלמות
//     const allCompletedTasks = [
//       // משימות רגילות שהושלמו
//       ...regularTasks
//         .filter(t => t.status === 'הושלם')
//         .map(t => ({
//           ...t.toObject(),
//           taskType: 'רגילה',
//           effectiveDate: new Date(t.createdAt),
//           effectiveStatus: t.status,
//           importance: t.importance
//         })),
//       // משימות קבועות שהושלמו
//       ...completedRecurringTasks
//     ];

//     // פונקציה לחישוב מפתח תקופה
//     const getPeriodKey = (date, periodType) => {
//       const taskDate = dayjs(date).tz("Asia/Jerusalem");

//       switch (periodType) {
//         case 'week':
//           return `${taskDate.isoWeekYear()}-W${taskDate.isoWeek().toString().padStart(2, '0')}`;
//         case 'month':
//           return `${taskDate.year()}-${(taskDate.month() + 1).toString().padStart(2, '0')}`;
//         case 'year':
//           return taskDate.year().toString();
//         default:
//           return taskDate.format('YYYY-MM');
//       }
//     };

//     // יצירת סיכום לפי תקופות - רק משימות שהושלמו
//     const summaryData = {};

//     allCompletedTasks.forEach(task => {
//       const taskDate = task.effectiveDate;
//       if (!taskDate || isNaN(taskDate)) return;

//       const periodKey = getPeriodKey(taskDate, period);

//       if (!summaryData[periodKey]) {
//         summaryData[periodKey] = {
//           period: periodKey,
//           completedTasks: 0,
//           byImportance: {},
//           byTaskType: { רגילה: 0, קבועה: 0 }
//         };
//       }

//       const summary = summaryData[periodKey];
//       summary.completedTasks++;
//       summary.byImportance[task.importance] = (summary.byImportance[task.importance] || 0) + 1;
//       summary.byTaskType[task.taskType]++;
//     });

//     // סדר התקופות
//     const sortedSummary = Object.values(summaryData)
//       .sort((a, b) => a.period.localeCompare(b.period));

//     // חישוב סטטיסטיקות כלליות
//     const overallStats = {
//       totalPeriods: sortedSummary.length,
//       totalCompletedTasks: sortedSummary.reduce((sum, item) => sum + item.completedTasks, 0),
//       totalRegularTasksCompleted: sortedSummary.reduce((sum, item) => sum + item.byTaskType.רגילה, 0),
//       totalRecurringTasksCompleted: sortedSummary.reduce((sum, item) => sum + item.byTaskType.קבועה, 0),
//       averageCompletedTasksPerPeriod: 0
//     };

//     if (overallStats.totalPeriods > 0) {
//       overallStats.averageCompletedTasksPerPeriod = Math.round(overallStats.totalCompletedTasks / overallStats.totalPeriods);
//     }

//     // חישוב ביצועים לפי חשיבות - רק משימות שהושלמו
//     const importanceStats = {};
//     allCompletedTasks.forEach(task => {
//       const importance = task.importance;
//       if (!importanceStats[importance]) {
//         importanceStats[importance] = { completed: 0 };
//       }
//       importanceStats[importance].completed++;
//     });


//     res.json({
//       success: true,
//       data: sortedSummary,
//       overallStats,
//       importanceStats,
//       period: {
//         type: period,
//         start: periodStart,
//         end: now
//       },
//       appliedFilters: req.query,
//       meta: {
//         regularTasksCount: regularTasks.length,
//         regularTasksCompletedCount: regularTasks.filter(t => t.status === 'הושלם').length,
//         recurringTasksCount: recurringTasks.length,
//         completedRecurringInstancesCount: completedRecurringTasks.length,
//         generatedAt: new Date().toISOString()
//       }
//     });

//   } catch (error) {
//     console.error('Error in getTasksSummaryByPeriod:', error);
//     res.status(500).json({
//       success: false,
//       message: 'שגיאה בשליפת סיכום משימות',
//       error: process.env.NODE_ENV === 'development' ? error.message : undefined
//     });
//   }
// };
// 5. סטטיסטיקה אישית לעובד - מעודכן
const calculatePercentage = (achieved, total) => total > 0 ? Math.round((achieved / total) * 100) : 0;

export const getEmployeePersonalStats = async (req, res) => {
  try {
    const userId = req.user.id;
    saveUserFilter(userId, 'employeePersonalStats', req.query);

    const taskFilter = buildTaskFilter(req.query);

    let employeesQuery = { role: 'עובד' };
    if (req.query.employeeId) {
      employeesQuery._id = req.query.employeeId;
    }

    const employees = await User.find(employeesQuery);

    const employeeStats = await Promise.all(employees.map(async (employee) => {
      const empId = employee._id.toString();

      const baseFilter = {
        ...taskFilter,
        $or: [
          { creator: empId },
          { mainAssignee: empId },
          { assignees: { $in: [empId] } }
        ]
      };

      // משימות רגילות
      const tasks = await Task.find(baseFilter);

      // משימות קבועות
      const recurringTasks = await RecurringTask.find(baseFilter)
        .populate('notes.user', 'firstName lastName userName role');

      // המרת משימות קבועות לביצועים נפרדים
      const expandedRecurringTasks = expandRecurringTasks(recurringTasks, {
        startDate: req.query.startDate,
        endDate: req.query.endDate
      });

      // שילוב כל המשימות
      const allTasks = [
        ...tasks.map(t => ({ ...t.toObject(), taskType: 'רגילה', isFromNote: false })),
        ...expandedRecurringTasks
      ];

      const totalTasks = allTasks.length;
      const completedTasks = allTasks.filter(t => {
        const status = t.isFromNote ? t.noteStatus : t.status;
        return status === 'הושלם';
      }).length;

      const overdueTasks = allTasks.filter(t => {
        const status = t.isFromNote ? t.noteStatus : t.status;
        return t.finalDeadline &&
          new Date(t.finalDeadline) < new Date() &&
          status !== 'הושלם';
      }).length;

      const completionRate = calculatePercentage(completedTasks, totalTasks);
      const onTimeRate = calculatePercentage(totalTasks - overdueTasks, totalTasks);

      // שליפת יעדים אישיים ויעדים כלליים
      const personalGoals = await Goal.find({ targetType: 'עובד בודד', employee: empId });
      const generalGoals = await Goal.find({ targetType: 'כלל העובדים' });

      // חישוב אחוז עמידה ביעדים
      const allGoals = [...personalGoals, ...generalGoals];
      let totalGoalTarget = 0;
      let totalGoalAchieved = 0;

      allGoals.forEach(goal => {
        const achievedCount = allTasks.filter(task => {
          const status = task.isFromNote ? task.noteStatus : task.status;
          return task.importance === goal.importance &&
            (!goal.subImportance || task.subImportance === goal.subImportance) &&
            status === 'הושלם';
        }).length;

        totalGoalAchieved += achievedCount;
        totalGoalTarget += goal.targetCount;
      });

      const overallGoalPercentage = calculatePercentage(totalGoalAchieved, totalGoalTarget);

      return {
        employeeId: empId,
        userName: employee.userName,
        fullName: `${employee.firstName} ${employee.lastName}`,
        completionRate,
        onTimeRate,
        overallGoalPercentage,
        taskBreakdown: {
          regular: tasks.length,
          recurring: expandedRecurringTasks.length,
          total: totalTasks
        }
      };
    }));

    res.json({
      success: true,
      data: employeeStats,
      appliedFilters: req.query
    });

  } catch (error) {
    console.error('Error in getEmployeePersonalStats:', error);
    res.status(500).json({ success: false, message: 'שגיאה בשליפת סטטיסטיקות אישיות' });
  }
};