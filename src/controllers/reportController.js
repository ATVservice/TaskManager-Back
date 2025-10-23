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

  return await TaskAssigneeDetails.find(query)
    .populate('user', 'firstName lastName userName')
    .lean();
};

// פונקציה חדשה להמרת משימות קבועות לביצועים נפרדים
const expandRecurringTasks = (recurringTasks, dateFilter = null) => {
  const expandedTasks = [];

  recurringTasks.forEach(task => {
    // אם אין notes, זה אומר שהמשימה לא בוצעה אף פעם
    if (!task.notes || task.notes.length === 0) {
      expandedTasks.push({
        ...task,
        taskType: 'קבועה',
        noteDate: null,
        noteStatus: task.status,
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
          ...task,
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

// 1. דוח משימות פתוחות לפי עובדים
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
      .sort({ createdAt: -1 })
      .lean();

    const recurringTasks = await RecurringTask.find(baseFilter)
      .populate('creator', 'firstName lastName userName role')
      .populate('mainAssignee', 'firstName lastName userName role')
      .populate('assignees', 'firstName lastName userName role')
      .populate('organization', 'name')
      .populate('notes.user', 'firstName lastName userName role')
      .sort({ createdAt: -1 })
      .lean();

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
    })
      .populate('user', 'firstName lastName userName role')
      .lean();

    const detailsByTask = {};
    allAssigneeDetails.forEach(d => {
      detailsByTask[d.taskId.toString()] = detailsByTask[d.taskId.toString()] || [];
      detailsByTask[d.taskId.toString()].push(d);
    });

    const allTasks = [
      ...regularTasks.map(t => ({ ...t, taskType: 'רגילה', assigneeDetails: detailsByTask[t._id.toString()] || [] })),
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

      employees.forEach(emp => {
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

// 2. דוח משימות לפי אחראים ראשיים ומשניים 
export const getTasksByResponsibility = async (req, res) => {
  try {
    const { responsibilityType = 'all' } = req.query;
    const userId = req.user.id;
    saveUserFilter(userId, 'tasksByResponsibility', req.query);

    const { employeeId, ...filterParams } = req.query;
    let baseFilter = buildTaskFilter(filterParams);

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

    //  שליפה ראשונית של משימות רגילות וקבועות 
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
      {
        $lookup: {
          from: 'users',
          localField: 'notes.user',
          foreignField: '_id',
          as: 'noteUsersData'
        }
      }
    ]);

    //  שליפת TaskAssigneeDetails לכל המשימות (רגילות + קבועות) 
    const regularIds = regularTasks.map(t => t._id).filter(Boolean);
    const recurringIds = recurringTasksRaw.map(t => t._id).filter(Boolean);

    const detailsQueryOr = [];
    if (regularIds.length) detailsQueryOr.push({ taskId: { $in: regularIds }, taskModel: 'Task' });
    if (recurringIds.length) detailsQueryOr.push({ taskId: { $in: recurringIds }, taskModel: 'RecurringTask' });

    const allAssigneeDetails = detailsQueryOr.length
      ? await TaskAssigneeDetails.find({ $or: detailsQueryOr }).lean()
      : [];

    const detailsByTask = {};
    allAssigneeDetails.forEach(d => {
      const k = String(d.taskId);
      detailsByTask[k] = detailsByTask[k] || {};
      detailsByTask[k][String(d.user)] = d;
    });

    const expandedRecurringTasks = [];
    for (const rtask of recurringTasksRaw) {
      const taskIdStr = String(rtask._id);
      const notes = Array.isArray(rtask.notes) ? rtask.notes : [];

      if (notes.length === 0) {
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
        const dayKey = new Date(n.date).toISOString().slice(0, 10);
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
            // השוואת תאריכים ונבחר את החדש ביותר
            if (new Date(n.date) > new Date(lastNoteByUser[uid].date)) lastNoteByUser[uid] = n;
          }
        });

        const occurrenceNotesMap = {};
        Object.entries(lastNoteByUser).forEach(([uid, note]) => {
          occurrenceNotesMap[uid] = note;
        });

        const computeOccurrenceOverallStatus = (taskObj, notesMap, detailsMapForTask) => {
          const mainIdStr = taskObj.mainAssigneeData && taskObj.mainAssigneeData[0]
            ? String(taskObj.mainAssigneeData[0]._id)
            : (taskObj.mainAssignee ? String(taskObj.mainAssignee) : null);

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

          if (mainIdStr) {
            const mainStatus = effectiveStatusForUser(mainIdStr);
            if (mainStatus === 'הושלם') return 'הושלם';
          }

          // בדיקה: האם היוצר סימן הושלם (אם יש note של היוצר לאותו יום)
          const creatorIdStr = taskObj.creator ? String(taskObj.creator) : null;
          if (creatorIdStr && notesMap && notesMap[creatorIdStr] && notesMap[creatorIdStr].status === 'הושלם') {
            return 'הושלם';
          }

          // אחרת בודק משניים: נדרוש שיש סטטוס לכל משני (details או note) ואז כולם 'הושלם'
          const assigneesArr = taskObj.assigneesData && taskObj.assigneesData.length
            ? taskObj.assigneesData.map(a => String(a._id))
            : (Array.isArray(taskObj.assignees) ? taskObj.assignees.map(a => String(a)) : []);

          //  רק משניים (לא הראשי אם קיים)
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

          // אחרת — לא ניתן לטעון שהושלם לפי כללי המשניים, מחזיר כברירת מחדל את סטטוס התבנית
          return taskObj.status || 'לביצוע';
        };

        const overallStatus = computeOccurrenceOverallStatus(rtask, occurrenceNotesMap, detailsByTask[taskIdStr]);

        expandedRecurringTasks.push({
          ...rtask,
          taskType: 'קבועה',
          noteStatus: overallStatus,
          noteDate: new Date(dayKey).toISOString(),
          isFromNote: true,
          _occurrenceNotesMap: occurrenceNotesMap,
          _taskAssigneeDetailsMap: detailsByTask[taskIdStr] || {}
        });
      }
    }

    const allTasks = [
      ...regularTasks.map(t => ({ ...t, taskType: 'רגילה', _taskAssigneeDetailsMap: detailsByTask[String(t._id)] || {} })),
      ...expandedRecurringTasks
    ];

    //  בניית הדוח לפי אחראים (main/secondary) עם הסטטוסים המותאמים לעובד 
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

    const computeOverallStatusForTaskRecord = (taskObj) => {
      if (taskObj.isFromNote) {
        return taskObj.noteStatus || taskObj.status || 'לביצוע';
      }
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

      //  MAIN responsible 
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

      //  סיכום כללי (byImportance/byStatus) לפי overallStatus
      responsibilityReport.summary.byImportance[task.importance] =
        (responsibilityReport.summary.byImportance[task.importance] || 0) + 1;
      responsibilityReport.summary.byStatus[overallStatus] =
        (responsibilityReport.summary.byStatus[overallStatus] || 0) + 1;
    });

    //  סינון לפי סוג אחריות אם נדרש 
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
      .sort({ finalDeadline: 1 })
      .lean();

    // משימות קבועות באיחור
    const overdueRecurringTasks = await RecurringTask.find(baseFilter)
      .populate('creator', 'firstName lastName userName')
      .populate('mainAssignee', 'firstName lastName userName')
      .populate('assignees', 'firstName lastName userName')
      .populate('organization', 'name')
      .populate('notes.user', 'firstName lastName userName')
      .sort({ finalDeadline: 1 })
      .lean();

    // המרת משימות קבועות לביצועים נפרדים - רק אלה שלא הושלמו
    const expandedOverdueRecurringTasks = expandRecurringTasks(overdueRecurringTasks)
      .filter(task => {
        const taskStatus = task.isFromNote ? task.noteStatus : task.status;
        return !['הושלם', 'בוטלה'].includes(taskStatus);
      });

    // שילוב המשימות
    const allOverdueTasks = [
      ...overdueTasks.map(task => ({ ...task, taskType: 'רגילה', isFromNote: false })),
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
// 4. סיכום משימות לפי תקופה 

const ISRAEL_TIMEZONE = "Asia/Jerusalem";
const MAX_DAYS_LIMITS = { week: 70, month: 365, year: 3650 };

// Cache גלובלי לביצועים
const taskCompletionCache = new Map();
const dateGenerationCache = new Map();

// פונקציות עזר 
const getIsraeliDate = (date) => dayjs(date).tz(ISRAEL_TIMEZONE);
const getStartOfDay = (date) => getIsraeliDate(date).startOf('day');
const getEndOfDay = (date) => getIsraeliDate(date).endOf('day');

// פונקציה  לקביעת טווח תאריכים
const getPeriodRange = (period) => {
  const now = getIsraeliDate();
  let periodStart;
  let maxDays = MAX_DAYS_LIMITS.month;

  switch (period) {
    case 'week':
      periodStart = now.subtract(10, 'week').startOf('isoWeek'); // שבוע ISO מלא
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

  const daysDiff = now.diff(periodStart, 'day');
  if (daysDiff > maxDays) {
    periodStart = now.subtract(maxDays, 'day').startOf('day');
  }

  return {
    start: periodStart.toDate(),
    end: now.endOf('day').toDate()
  };
};

// פונקציה מוטבת לבדיקת השלמת משימה עם cache חכם
const isRecurringTaskCompleted = (task, targetDate) => {
  const dateKey = targetDate.getTime();
  const cacheKey = `${task._id}-${dateKey}`;

  if (taskCompletionCache.has(cacheKey)) {
    return taskCompletionCache.get(cacheKey);
  }

  try {
    if (!task.notes?.length) {
      taskCompletionCache.set(cacheKey, false);
      return false;
    }

    const targetDay = getStartOfDay(targetDate);

    // סינון מהיר יותר עם בדיקה מוקדמת של תאריכים
    const dayNotes = task.notes.filter(note => {
      if (!note.date) return false;
      const noteDate = getStartOfDay(note.date);
      return noteDate.isSame(targetDay, 'day');
    });

    if (!dayNotes.length) {
      taskCompletionCache.set(cacheKey, false);
      return false;
    }

    // אופטימיזציה: בדיקה מהירה למנהל קודם לכל
    const hasManagerCompletion = dayNotes.some(note =>
      note.status === 'הושלם' && note.user?.role === 'מנהל'
    );

    if (hasManagerCompletion) {
      taskCompletionCache.set(cacheKey, true);
      return true;
    }

    // בדיקת השלמה רגילה עם Set לביצועים טובים יותר
    const mainAssigneeId = task.mainAssignee?._id?.toString();
    const assigneeIds = new Set(
      task.assignees?.map(a => a._id.toString()).filter(id => id !== mainAssigneeId) || []
    );

    // מיון ועיבוד ההערות
    const sortedNotes = dayNotes.sort((a, b) => new Date(a.date) - new Date(b.date));
    const lastStatusByUser = new Map();

    sortedNotes.forEach(note => {
      if (note.user) {
        const userId = (typeof note.user === 'object' ? note.user._id : note.user).toString();
        lastStatusByUser.set(userId, note.status);
      }
    });

    const completedUsers = new Set();
    lastStatusByUser.forEach((status, userId) => {
      if (status === 'הושלם') {
        completedUsers.add(userId);
      }
    });

    if (completedUsers.size === 0) {
      taskCompletionCache.set(cacheKey, false);
      return false;
    }

    let isCompleted = false;

    // בדיקת אחראי ראשי
    if (mainAssigneeId && completedUsers.has(mainAssigneeId)) {
      isCompleted = true;
    }
    // בדיקת כל האחראים השניים
    else if (assigneeIds.size > 0) {
      isCompleted = Array.from(assigneeIds).every(id => completedUsers.has(id));
    }

    taskCompletionCache.set(cacheKey, isCompleted);
    return isCompleted;

  } catch (error) {
    console.error(`Error checking task completion for ${task._id}:`, error.message);
    taskCompletionCache.set(cacheKey, false);
    return false;
  }
};

// פונקציה חכמה ליצירת תאריכים עם cache וללא מגבלות מזיקות
const generateRecurringDatesOptimized = (task, startDate, endDate) => {
  // Cache key עבור תאריכים
  const cacheKey = `${task._id}-${startDate.getTime()}-${endDate.getTime()}`;
  if (dateGenerationCache.has(cacheKey)) {
    return dateGenerationCache.get(cacheKey);
  }

  const dates = [];
  const start = getStartOfDay(startDate);
  const end = getEndOfDay(endDate);

  const totalDays = end.diff(start, 'day') + 1;
  const SAFETY_LIMIT = Math.max(totalDays * 1.5, 10000); // מגבלה גבוהה מאוד
  let count = 0;

  const addDateIfValid = (date) => {
    if (date.isBetween(start, end, null, '[]')) {
      dates.push(date.toDate());
    }
  };

  try {
    switch (task.frequencyType) {
      case 'יומי':
        let current = start;
        while (current.isSameOrBefore(end) && count < SAFETY_LIMIT) {
          count++;

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
          while (currentDay.isSameOrBefore(end) && count < SAFETY_LIMIT) {
            count++;

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
        while (monthCursor.isSameOrBefore(end, 'month') && count < SAFETY_LIMIT) {
          count++;

          const targetDay = Math.min(dayOfMonth, monthCursor.daysInMonth());
          const date = monthCursor.date(targetDay);
          addDateIfValid(date);
          monthCursor = monthCursor.add(1, 'month');
        }
        break;

      case 'שנתי':
        const taskCreatedDate = getIsraeliDate(task.createdAt || task.updatedAt || new Date());

        const targetMonth = task.frequencyDetails?.month ?
          Math.max(0, Math.min(11, task.frequencyDetails.month - 1)) :
          taskCreatedDate.month();

        const targetDay = task.frequencyDetails?.day ?
          Math.max(1, Math.min(31, task.frequencyDetails.day)) :
          taskCreatedDate.date();

        let yearCursor = start.startOf('year');
        while (yearCursor.isSameOrBefore(end, 'year') && count < SAFETY_LIMIT) {
          count++;

          const yearDate = yearCursor.month(targetMonth);
          const finalDay = Math.min(targetDay, yearDate.daysInMonth());
          const date = yearDate.date(finalDay);
          addDateIfValid(date);
          yearCursor = yearCursor.add(1, 'year');
        }
        break;
    }

    if (count >= SAFETY_LIMIT) {
      console.warn(`Safety limit reached for task ${task._id}. Generated ${dates.length} dates from ${count} iterations.`);
    }

  } catch (error) {
    console.error(`Error generating dates for task ${task._id}:`, error.message);
  }

  // שמירה בcache
  dateGenerationCache.set(cacheKey, dates);
  return dates;
};

// פונקציה מוטבת לחישוב מפתח תקופה
const getPeriodKey = (date, periodType) => {
  const israeliDate = getIsraeliDate(date);

  switch (periodType) {
    case 'week':
      const weekStart = israeliDate.startOf('isoWeek');
      return `${weekStart.isoWeekYear()}-W${weekStart.isoWeek().toString().padStart(2, '0')}`;
    case 'year':
      return israeliDate.year().toString();
    case 'month':
    default:
      return israeliDate.format('YYYY-MM');
  }
};

// פונקציה מוטבת ליצירת סיכום עם Map
const createSummaryData = (completedTasks, period) => {
  const summaryMap = new Map();

  completedTasks.forEach(task => {
    if (!task.effectiveDate || isNaN(new Date(task.effectiveDate))) return;

    const periodKey = getPeriodKey(task.effectiveDate, period);

    if (!summaryMap.has(periodKey)) {
      summaryMap.set(periodKey, {
        period: periodKey,
        completedTasks: 0,
        byImportance: {},
        byTaskType: { רגילה: 0, קבועה: 0 }
      });
    }

    const summary = summaryMap.get(periodKey);
    summary.completedTasks++;
    summary.byImportance[task.importance] = (summary.byImportance[task.importance] || 0) + 1;
    summary.byTaskType[task.taskType]++;
  });

  return Array.from(summaryMap.values()).sort((a, b) => a.period.localeCompare(b.period));
};

// פונקציה לניקוי cache
const cleanupCache = () => {
  const MAX_CACHE_SIZE = 5000;

  if (taskCompletionCache.size > MAX_CACHE_SIZE) {
    const keysToDelete = Array.from(taskCompletionCache.keys()).slice(0, taskCompletionCache.size - MAX_CACHE_SIZE + 1000);
    keysToDelete.forEach(key => taskCompletionCache.delete(key));
  }

  if (dateGenerationCache.size > 1000) {
    const keysToDelete = Array.from(dateGenerationCache.keys()).slice(0, dateGenerationCache.size - 500);
    keysToDelete.forEach(key => dateGenerationCache.delete(key));
  }
};

// פונקציה לעיבוד batch של משימות קבועות
const processBatchRecurringTasks = (tasks, periodStart, periodEnd, batchSize = 20) => {
  const completedRecurringTasks = [];

  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);

    batch.forEach(task => {
      try {
        const possibleDates = generateRecurringDatesOptimized(task, periodStart, periodEnd);

        possibleDates.forEach(date => {
          if (isRecurringTaskCompleted(task, date)) {
            completedRecurringTasks.push({
              _id: task._id,
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
        console.error(`Error processing recurring task ${task._id}:`, error.message);
      }
    });
  }

  return completedRecurringTasks;
};

// הפונקציה הראשית המוטבת
export const getTasksSummaryByPeriod = async (req, res) => {
  const startTime = Date.now();

  try {
    const { period = 'month' } = req.query;
    const userId = req.user.id;

    // ניקוי cache מדי פעם
    cleanupCache();

    // שמירת פילטר
    if (typeof saveUserFilter === 'function') {
      saveUserFilter(userId, 'tasksSummary', req.query);
    }

    let baseFilter = {};
    if (typeof buildTaskFilter === 'function') {
      baseFilter = buildTaskFilter(req.query);
    }

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

    const { start: periodStart, end: periodEnd } = getPeriodRange(period);

    regularFilter.createdAt = regularFilter.createdAt || {
      $gte: periodStart,
      $lte: periodEnd
    };

    // שליפת נתונים מוטבת עם projection מדויק
    const [regularTasks, recurringTasks] = await Promise.all([
      Task.find({ ...regularFilter, isDeleted: { $ne: true } })
        .select('status createdAt importance taskId')
        .populate('mainAssignee', 'firstName lastName')
        .populate('assignees', 'firstName lastName')
        .lean(),

      RecurringTask.find({
        ...recurringFilter,
        isDeleted: { $ne: true }
      })
        .select('taskId frequencyType frequencyDetails notes importance mainAssignee assignees createdAt updatedAt')
        .populate('notes.user', 'firstName lastName userName role')
        .populate('mainAssignee', 'firstName lastName')
        .populate('assignees', 'firstName lastName')
        .lean()
    ]);

    // עיבוד משימות קבועות עם batch processing
    const completedRecurringTasks = processBatchRecurringTasks(
      recurringTasks,
      periodStart,
      periodEnd,
      25 // גודל batch מותאם
    );

    // שילוב משימות מושלמות
    const allCompletedTasks = [
      ...regularTasks
        .filter(t => t.status === 'הושלם')
        .map(t => ({
          _id: t._id,
          taskType: 'רגילה',
          effectiveDate: t.createdAt,
          effectiveStatus: t.status,
          importance: t.importance
        })),
      ...completedRecurringTasks
    ];

    const sortedSummary = createSummaryData(allCompletedTasks, period);

    // חישוב סטטיסטיקות
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

    const importanceStats = {};
    allCompletedTasks.forEach(task => {
      const importance = task.importance;
      importanceStats[importance] = importanceStats[importance] || { completed: 0 };
      importanceStats[importance].completed++;
    });

    const processingTime = Date.now() - startTime;

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
        processingTimeMs: processingTime,
        cacheStats: {
          completionCacheSize: taskCompletionCache.size,
          dateGenerationCacheSize: dateGenerationCache.size
        },
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
// 5. סטטיסטיקה אישית לעובד 
const calculatePercentage = (achieved, total) => {
  if (total <= 0) return 0;
  const percentage = (achieved / total) * 100;
  return Math.min(Math.round(percentage), 100); // מוודא שלא יעלה על 100%
};

// פונקציה להמרת תאריך לאזור זמן ישראל
const toIsraeliTime = (date) => {
  return new Date(new Date(date).toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
};

// פונקציה לקבלת תחילת היום בזמן ישראל
const getStartOfDay1 = (date) => {
  const israeliDate = toIsraeliTime(date);
  israeliDate.setHours(0, 0, 0, 0);
  return israeliDate;
};

// פונקציה לקבלת סוף היום בזמן ישראל
const getEndOfDay1 = (date) => {
  const israeliDate = toIsraeliTime(date);
  israeliDate.setHours(23, 59, 59, 999);
  return israeliDate;
};

// פונקציה לקבלת העדכון האחרון ביום מ-TaskAssigneeDetails
const getLastDailyUpdateFromAssigneeDetails = async (taskId, taskModel, userId, targetDate) => {
  const startOfDay = getStartOfDay1(targetDate);
  const endOfDay = getEndOfDay1(targetDate);

  const updates = await TaskAssigneeDetails.find({
    taskId,
    taskModel,
    user: userId,
    updatedAt: { $gte: startOfDay, $lte: endOfDay }
  }).sort({ updatedAt: -1 }).limit(1);

  return updates.length > 0 ? updates[0] : null;
};

// פונקציה לקבלת העדכון האחרון ביום מ-notes של משימה קבועה
const getLastDailyUpdateFromNotes = (notes, targetDate) => {
  const startOfDay = getStartOfDay1(targetDate);
  const endOfDay = getEndOfDay1(targetDate);

  const dailyNotes = notes.filter(note => {
    const noteDate = new Date(note.date);
    return noteDate >= startOfDay && noteDate <= endOfDay;
  });

  // מיון לפי תאריך יורד ולקיחת הראשון (האחרון ביום)
  return dailyNotes.sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
};

// פונקציה ליצירת מערך ימים בטווח התאריכים
const createDateRange = (startDate, endDate) => {
  const dates = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  // וידוא שאנו מתחילים מתחילת היום
  current.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
};

// פונקציה מורחבת לעיבוד משימות קבועות לפי ימים
const processRecurringTasksByDays = async (recurringTasks, dateRange, userId) => {
  const processedTasks = [];

  for (const task of recurringTasks) {
    let datesToProcess = dateRange;

    // אם אין טווח תאריכים, נבנה טווח על פי כל התאריכים הקיימים ב-notes
    if (!datesToProcess || !Array.isArray(datesToProcess)) {
      const allNoteDates = task.notes.map(note => getStartOfDay1(note.date));
      // יוצרים מערך ייחודי של תאריכים
      const uniqueDates = [...new Set(allNoteDates.map(d => d.getTime()))].map(t => new Date(t));
      // מיון לפי סדר כרונולוגי
      datesToProcess = uniqueDates.sort((a, b) => a - b);
    }

    // עכשיו עוברים על כל התאריכים ומקבלים את הסטטוס האחרון של כל יום
    for (const targetDate of datesToProcess) {
      const lastNote = getLastDailyUpdateFromNotes(task.notes, targetDate);

      if (lastNote) {
        processedTasks.push({
          ...task,
          taskType: 'קבועה',
          isFromNote: true,
          noteStatus: lastNote.status,
          noteContent: lastNote.content,
          processedDate: targetDate,
          lastUpdate: lastNote.date
        });
      }
    }
  }

  return processedTasks;
};


// פונקציה מורחבת לעיבוד משימות רגילות לפי ימים
const processRegularTasksByDays = async (tasks, dateRange, userId) => {
  const processedTasks = [];

  for (const task of tasks) {

    if (dateRange && Array.isArray(dateRange)) {
      // עיבוד לפי ימים אם קיים טווח
      for (const targetDate of dateRange) {
        const lastUpdate = await getLastDailyUpdateFromAssigneeDetails(
          task._id,
          'Task',
          userId,
          targetDate
        );

        if (lastUpdate) {
          processedTasks.push({
            ...task,
            taskType: 'רגילה',
            isFromNote: false,
            assigneeStatus: lastUpdate.status,
            assigneeNote: lastUpdate.statusNote,
            processedDate: targetDate,
            lastUpdate: lastUpdate.updatedAt
          });
        }
      }
    } else {
      // אין טווח תאריכים -> לקחת את העדכון האחרון הקיים
      if (task.status === 'הושלם') {
        processedTasks.push({
          ...task,
          taskType: 'רגילה',
          isFromNote: false,
          assigneeStatus: task.status,
          assigneeNote: task.statusNote || '',
          processedDate: task.updatedAt || new Date(),
          lastUpdate: task.updatedAt || new Date()
        });
      } else {
        // חפש ב-TaskAssigneeDetails אם העובד סיים
        const lastUpdate = await TaskAssigneeDetails.findOne({
          taskId: task._id,
          taskModel: 'Task',
          user: userId
        }).sort({ updatedAt: -1 });

        if (lastUpdate && lastUpdate.status === 'הושלם') {
          processedTasks.push({
            ...task,
            taskType: 'רגילה',
            isFromNote: false,
            assigneeStatus: lastUpdate.status,
            assigneeNote: lastUpdate.statusNote,
            processedDate: lastUpdate.updatedAt,
            lastUpdate: lastUpdate.updatedAt
          });
        }
      }

    }
  }

  return processedTasks;
};

export const getEmployeePersonalStats = async (req, res) => {
  try {
    const userId = req.user.id;
    saveUserFilter(userId, 'employeePersonalStats', req.query);

    const taskFilter = buildTaskFilter(req.query);

    let employeesQuery;
    if (req.query.employeeId) {
      employeesQuery._id = req.query.employeeId;
    }

    const employees = await User.find(employeesQuery);

    // יצירת טווח תאריכים לעיבוד
    let startDate = null;
    let endDate = null;
    let dateRange = null;

    if (req.query.startDate || req.query.endDate) {
      startDate = req.query.startDate ? new Date(req.query.startDate) : new Date('1970-01-01');
      endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
      dateRange = createDateRange(startDate, endDate);

      console.log("טווח תאריכים:", dateRange.map(d => d.toISOString()));
    } else {
      console.log(" אין סינון תאריכים - מביא את כל המשימות");
    }


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

      // שליפת משימות רגילות
      const regularTasks = await Task.find(baseFilter);
      console.log(`👤 ${employee.userName} | נמצאו ${regularTasks.length} משימות רגילות`);

      // שליפת משימות קבועות
      const recurringTasks = await RecurringTask.find(baseFilter)
        .populate('notes.user', 'firstName lastName userName role')
        .lean();
      console.log(`👤 ${employee.userName} | נמצאו ${recurringTasks.length} משימות קבועות`);

      // עיבוד משימות
      const processedRegularTasks = await processRegularTasksByDays(
        regularTasks,
        dateRange,
        empId
      );
      console.log(`👤 ${employee.userName} | עיבוד משימות רגילות -> ${processedRegularTasks.length}`);

      const processedRecurringTasks = await processRecurringTasksByDays(
        recurringTasks,
        dateRange,
        empId
      );
      console.log(`👤 ${employee.userName} | עיבוד משימות קבועות -> ${processedRecurringTasks.length}`);

      // הדפסת כל משימה וסטטוס אחרון
      [...processedRegularTasks, ...processedRecurringTasks].forEach(task => {
        console.log(
          `   📝 ${task.taskType} | ${task.name || task.title || task._id} |`,
          `סטטוס: ${task.isFromNote ? task.noteStatus : task.assigneeStatus} |`,
          `תאריך: ${task.processedDate?.toISOString() || '---'}`
        );
      });

      // שילוב כל המשימות
      const allProcessedTasks = [
        ...processedRegularTasks,
        ...processedRecurringTasks
      ];

      // חישובי סטטיסטיקה
      const totalTasks = allProcessedTasks.length;
      const completedTasks = allProcessedTasks.filter(task => {
        const status = task.isFromNote ? task.noteStatus : task.assigneeStatus;
        return status === 'הושלם';
      }).length;

      const overdueTasks = allProcessedTasks.filter(task => {
        const status = task.isFromNote ? task.noteStatus : task.assigneeStatus;
        const deadline = task.finalDeadline || task.dueDate;
        return deadline &&
          new Date(deadline) < new Date(task.processedDate) &&
          status !== 'הושלם';
      }).length;

      console.log(`👤 ${employee.userName} | סה"כ: ${totalTasks} | הושלמו: ${completedTasks} | באיחור: ${overdueTasks}`);

      const completionRate = calculatePercentage(completedTasks, totalTasks);
      const onTimeRate = calculatePercentage(totalTasks - overdueTasks, totalTasks);

      const personalGoals = await Goal.find({ targetType: 'עובד בודד', employee: empId });
      const generalGoals = await Goal.find({ targetType: 'כלל העובדים' });
      const allGoals = [...personalGoals, ...generalGoals];

      let totalGoalTarget = 0;
      let totalGoalAchieved = 0;

      allGoals.forEach(goal => {
        const achievedCount = allProcessedTasks.filter(task => {
          const status = task.isFromNote ? task.noteStatus : task.assigneeStatus;
          return task.importance === goal.importance &&
            (!goal.subImportance || task.subImportance === goal.subImportance) &&
            status === 'הושלם';
        }).length;
        console.log(employee.userName)
        console.log(`🎯 יעד (${goal.importance}${goal.subImportance ? ' - ' + goal.subImportance : ''}): `
          + `מטרה=${goal.targetCount}, הושגו=${achievedCount}`);

        totalGoalAchieved += achievedCount;
        totalGoalTarget += goal.targetCount;
      });

      const overallGoalPercentage = calculatePercentage(totalGoalAchieved, totalGoalTarget);

      return {
        employeeId: empId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        userName: employee.userName,
        tasksCompleted: completedTasks,
        completionRate,
        onTimeRate,
        goalAchievementRate: overallGoalPercentage,
        taskBreakdown: {
          regular: processedRegularTasks.length,
          recurring: processedRecurringTasks.length,
          total: totalTasks
        },
        details: {
          totalGoalTarget,
          totalGoalAchieved,
          overdueTasks
        }
      };
    }));

    res.json({
      success: true,
      data: employeeStats,
      appliedFilters: req.query,
      dateRange: {
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
        totalDays: dateRange?.length || 'כל הזמנים'
      }

    });

  } catch (error) {
    console.error('Error in getEmployeePersonalStats:', error);
    res.status(500).json({
      success: false,
      message: 'שגיאה בשליפת סטטיסטיקות אישיות',
      error: error.message
    });
  }
};
