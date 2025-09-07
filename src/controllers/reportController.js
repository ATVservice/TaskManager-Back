import mongoose from 'mongoose';
import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';
import User from '../models/User.js';
import Association from '../models/Association.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import Goal from '../models/Goal.js';
import UserFilter from '../models/UserFilter.js';

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

// 1. דוח משימות פתוחות לפי עובדים - מעודכן
export const getOpenTasksByEmployee = async (req, res) => {
  const { status = ['בתהליך', 'מושהה', 'בטיפול'] } = req.query;
  const userId = req.user.id;

  // שמירת פילטר
  saveUserFilter(userId, 'openTasks', req.query);

  let baseFilter = buildTaskFilter({
    ...req.query,
    status
  });

  // חיפוש במשימות רגילות
  const regularTasks = await Task.find(baseFilter)
    .populate('creator', 'firstName lastName userName')
    .populate('mainAssignee', 'firstName lastName userName')
    .populate('assignees', 'firstName lastName userName')
    .populate('organization', 'name')
    .sort({ createdAt: -1 });

  // חיפוש במשימות קבועות
  const recurringTasks = await RecurringTask.find(baseFilter)
    .populate('creator', 'firstName lastName userName')
    .populate('mainAssignee', 'firstName lastName userName')
    .populate('assignees', 'firstName lastName userName')
    .populate('organization', 'name')
    .populate('notes.user', 'firstName lastName userName')
    .sort({ createdAt: -1 });

  // המרת משימות קבועות לביצועים נפרדים
  const expandedRecurringTasks = expandRecurringTasks(recurringTasks, {
    startDate: req.query.startDate,
    endDate: req.query.endDate
  });

  // שילוב והעשרת הנתונים
  const allTasks = [];

  // משימות רגילות
  for (const task of regularTasks) {
    const assigneeDetails = await getAssigneeDetails(task._id, 'Task');
    allTasks.push({
      ...task.toObject(),
      daysOpen: task.daysOpen,
      taskType: 'רגילה',
      assigneeDetails,
      isFromNote: false
    });
  }

  // משימות קבועות מורחבות
  for (const task of expandedRecurringTasks) {
    // סינון לפי סטטוס של ה-note (לא הסטטוס של המשימה הקבועה)
    const taskStatus = task.isFromNote ? task.noteStatus : task.status;
    if (status.includes(taskStatus)) {
      const assigneeDetails = await getAssigneeDetails(task._id, 'RecurringTask');
      allTasks.push({
        ...task,
        status: taskStatus, // העדכן את הסטטוס לפי ה-note
        assigneeDetails
      });
    }
  }

  // קיבוץ לפי עובדים
  const tasksByEmployee = {};

  allTasks.forEach(task => {
    const employees = [
      { id: task.creator._id, name: `${task.creator.firstName} ${task.creator.lastName}`, userName: task.creator.userName, role: 'יוצר' },
      { id: task.mainAssignee._id, name: `${task.mainAssignee.firstName} ${task.mainAssignee.lastName}`, userName: task.mainAssignee.userName, role: 'אחראי ראשי' }
    ];

    task.assignees.forEach(assignee => {
      if (assignee._id.toString() !== task.mainAssignee._id.toString()) {
        employees.push({
          id: assignee._id,
          name: `${assignee.firstName} ${assignee.lastName}`,
          userName: assignee.userName,
          role: 'אחראי משני'
        });
      }
    });

    employees.forEach(emp => {
      if (!tasksByEmployee[emp.id]) {
        tasksByEmployee[emp.id] = {
          employee: emp,
          tasks: [],
          summary: {
            total: 0,
            byImportance: {},
            byStatus: {},
            overdue: 0,
            avgDaysOpen: 0,
            oldestOpenDays: 0
          }
        };
      }

      tasksByEmployee[emp.id].tasks.push({ ...task, employeeRole: emp.role });
      tasksByEmployee[emp.id].summary.total++;
      tasksByEmployee[emp.id].summary.byImportance[task.importance] =
        (tasksByEmployee[emp.id].summary.byImportance[task.importance] || 0) + 1;
      tasksByEmployee[emp.id].summary.byStatus[task.status] =
        (tasksByEmployee[emp.id].summary.byStatus[task.status] || 0) + 1;

      // בדיקה אם המשימה באיחור
      if (task.finalDeadline && new Date(task.finalDeadline) < new Date()) {
        tasksByEmployee[emp.id].summary.overdue++;
      }
    });
  });

  // חישוב ממוצע וותק משימות לכל עובד
  Object.values(tasksByEmployee).forEach(empData => {
    const daysArr = empData.tasks.map(t => t.daysOpen);
    if (daysArr.length > 0) {
      const sum = daysArr.reduce((a, b) => a + b, 0);
      empData.summary.avgDaysOpen = Math.round(sum / daysArr.length);
      empData.summary.oldestOpenDays = Math.max(...daysArr);
    }
  });

  let result = Object.values(tasksByEmployee);
  if (req.query.employeeId) {
    result = result.filter(emp => emp.employee.id.toString() === req.query.employeeId);
  }

  res.json({
    success: true,
    data: result,
    totalTasks: allTasks.length,
    appliedFilters: req.query
  });
};

// 2. דוח משימות לפי אחראים ראשיים ומשניים - מעודכן
export const getTasksByResponsibility = async (req, res) => {
  const {
    responsibilityType = 'all'
  } = req.query;

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
          newCondition[key] = new mongoose.Types.ObjectId(newCondition[key]);
        }
        if (key === 'assignees' && newCondition[key].$in) {
          newCondition[key].$in = newCondition[key].$in.map(id => new mongoose.Types.ObjectId(id));
        }
      });
      return newCondition;
    });
  }

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

  // המרת משימות קבועות לביצועים נפרדים
  const expandedRecurringTasks = [];
  recurringTasksRaw.forEach(task => {
    if (!task.notes || task.notes.length === 0) {
      expandedRecurringTasks.push({
        ...task,
        taskType: 'קבועה',
        noteStatus: task.status,
        isFromNote: false
      });
    } else {
      task.notes.forEach(note => {
        if (!req.query.startDate || !req.query.endDate || 
            (new Date(note.date) >= new Date(req.query.startDate) && 
             new Date(note.date) <= new Date(req.query.endDate))) {
          expandedRecurringTasks.push({
            ...task,
            taskType: 'קבועה',
            noteStatus: note.status,
            noteDate: note.date,
            status: note.status, // שימוש בסטטוס של ה-note
            isFromNote: true
          });
        }
      });
    }
  });

  const allTasks = [...regularTasks.map(t => ({ ...t, taskType: 'רגילה' })), ...expandedRecurringTasks];

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

  allTasks.forEach(task => {
    const mainAssignee = task.mainAssigneeData[0];
    const assignees = task.assigneesData;

    // אחראי ראשי
    if (mainAssignee && (!req.query.employeeId || mainAssignee._id.toString() === req.query.employeeId)) {
      const mainKey = mainAssignee._id.toString();
      if (!responsibilityReport.mainResponsible[mainKey]) {
        responsibilityReport.mainResponsible[mainKey] = {
          employee: {
            id: mainAssignee._id,
            name: `${mainAssignee.firstName} ${mainAssignee.lastName}`,
            userName: mainAssignee.userName
          },
          tasks: [],
          summary: { total: 0, byImportance: {}, byStatus: {} }
        };
      }

      responsibilityReport.mainResponsible[mainKey].tasks.push(task);
      responsibilityReport.mainResponsible[mainKey].summary.total++;
      responsibilityReport.summary.mainAssignees.add(mainKey);

      responsibilityReport.mainResponsible[mainKey].summary.byStatus[task.status] =
        (responsibilityReport.mainResponsible[mainKey].summary.byStatus[task.status] || 0) + 1;

      responsibilityReport.mainResponsible[mainKey].summary.byImportance[task.importance] =
        (responsibilityReport.mainResponsible[mainKey].summary.byImportance[task.importance] || 0) + 1;
    }

    // אחראים משניים
    assignees.forEach(assignee => {
      if (assignee._id.toString() !== task.mainAssignee.toString() &&
        (!req.query.employeeId || assignee._id.toString() === req.query.employeeId)) {

        const secondaryKey = assignee._id.toString();
        if (!responsibilityReport.secondaryResponsible[secondaryKey]) {
          responsibilityReport.secondaryResponsible[secondaryKey] = {
            employee: {
              id: assignee._id,
              name: `${assignee.firstName} ${assignee.lastName}`,
              userName: assignee.userName
            },
            tasks: [],
            summary: { total: 0, byImportance: {}, byStatus: {} }
          };
        }

        responsibilityReport.secondaryResponsible[secondaryKey].tasks.push(task);
        responsibilityReport.secondaryResponsible[secondaryKey].summary.total++;
        responsibilityReport.summary.secondaryAssignees.add(secondaryKey);

        responsibilityReport.secondaryResponsible[secondaryKey].summary.byStatus[task.status] =
          (responsibilityReport.secondaryResponsible[secondaryKey].summary.byStatus[task.status] || 0) + 1;

        responsibilityReport.secondaryResponsible[secondaryKey].summary.byImportance[task.importance] =
          (responsibilityReport.secondaryResponsible[secondaryKey].summary.byImportance[task.importance] || 0) + 1;
      }
    });

    // סיכום כללי
    responsibilityReport.summary.byImportance[task.importance] =
      (responsibilityReport.summary.byImportance[task.importance] || 0) + 1;
    responsibilityReport.summary.byStatus[task.status] =
      (responsibilityReport.summary.byStatus[task.status] || 0) + 1;
  });

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

  res.json({
    success: true,
    data: filteredResponse,
    appliedFilters: req.query
  });
};

// 3. דוח משימות חורגות מיעד - מעודכן
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
export const getTasksSummaryByPeriod = async (req, res) => {
  try {
    const {
      period = 'month'
    } = req.query;

    const userId = req.user.id;
    saveUserFilter(userId, 'tasksSummary', req.query);

    let baseFilter = buildTaskFilter(req.query);

    if (baseFilter.organization) {
      baseFilter.organization = new mongoose.Types.ObjectId(baseFilter.organization);
    }

    if (baseFilter.$or) {
      baseFilter.$or = baseFilter.$or.map(condition => {
        const newCondition = { ...condition };
        Object.keys(newCondition).forEach(key => {
          if (['creator', 'mainAssignee'].includes(key)) {
            newCondition[key] = new mongoose.Types.ObjectId(newCondition[key]);
          }
          if (key === 'assignees' && newCondition[key].$in) {
            newCondition[key].$in = newCondition[key].$in.map(id => new mongoose.Types.ObjectId(id));
          }
        });
        return newCondition;
      });
    }

    // קביעת טווח תאריכים אם לא הוגדר
    if (!req.query.startDate || !req.query.endDate) {
      const now = new Date();
      const MAX_PERIODS = period === 'week' ? 10 : period === 'month' ? 12 : 10;
      let periodStart;

      switch (period) {
        case 'week':
          periodStart = new Date();
          periodStart.setDate(now.getDate() - (MAX_PERIODS * 7));
          break;
        case 'month':
          periodStart = new Date(now.getFullYear(), now.getMonth() - (MAX_PERIODS - 1), 1);
          break;
        case 'year':
          periodStart = new Date(now.getFullYear() - (MAX_PERIODS - 1), 0, 1);
          break;
      }

      baseFilter.createdAt = {
        $gte: periodStart,
        $lte: now
      };
    }

    // שליפת משימות רגילות
    const regularTasks = await Task.find(baseFilter);
    
    // שליפת משימות קבועות עם populate של notes (בלי פילטר תאריך)
    const baseFilterWithoutDate = { ...baseFilter };
    delete baseFilterWithoutDate.createdAt;
    
    const recurringTasks = await RecurringTask.find(baseFilterWithoutDate)
      .populate('notes.user', 'firstName lastName userName');

    // המרת משימות קבועות לביצועים נפרדים
    const expandedRecurringTasks = [];
    
    recurringTasks.forEach(task => {
      if (!task.notes || task.notes.length === 0) {
        // אם אין notes - המשימה לא בוצעה אף פעם, נכלול אותה עם תאריך היצירה
        expandedRecurringTasks.push({
          ...task.toObject(),
          taskType: 'קבועה',
          noteDate: null,
          noteStatus: task.status,
          isFromNote: false
        });
      } else {
        // כל note הופך לביצוע נפרד
        task.notes.forEach(note => {
          // בדיקת פילטר תאריך אם קיים
          const noteDate = new Date(note.date);
          const startDate = req.query.startDate ? new Date(req.query.startDate) : baseFilter.createdAt?.$gte;
          const endDate = req.query.endDate ? new Date(req.query.endDate) : baseFilter.createdAt?.$lte;
          
          // אם יש פילטר תאריך, בדוק אם ה-note בטווח
          if (startDate && endDate) {
            if (noteDate < startDate || noteDate > endDate) {
              return; // דלג על note זה
            }
          }

          expandedRecurringTasks.push({
            ...task.toObject(),
            taskType: 'קבועה',
            noteDate: note.date,
            noteStatus: note.status,
            noteContent: note.content,
            noteUser: note.user,
            isFromNote: true
          });
        });
      }
    });

    // שילוב כל המשימות
    const allTasks = [
      ...regularTasks.map(t => ({ 
        ...t.toObject(), 
        taskType: 'רגילה',
        effectiveDate: new Date(t.createdAt),
        effectiveStatus: t.status,
        importance: t.importance
      })),
      ...expandedRecurringTasks.filter(t => {
        // סינון משימות עם תאריכים לא תקינים
        const dateToCheck = t.isFromNote ? t.noteDate : t.createdAt;
        return dateToCheck && !isNaN(new Date(dateToCheck));
      }).map(t => ({
        ...t,
        effectiveDate: t.isFromNote ? new Date(t.noteDate) : new Date(t.createdAt),
        effectiveStatus: t.isFromNote ? t.noteStatus : t.status,
        importance: t.importance
      }))
    ];

    // יצירת אובייקט סיכום ריק
    const summaryData = {};

    // לולאה על כל המשימות
    allTasks.forEach(task => {
      const taskDate = task.effectiveDate;
      
      // וודא שהתאריך תקין
      if (!taskDate || isNaN(taskDate)) {
        console.log('Invalid date found:', task);
        return; // דלג על משימה זו
      }
      
      let periodKey;
      
      // יצירת מפתח תקופה
      switch (period) {
        case 'week':
          const year = taskDate.getFullYear();
          const startOfYear = new Date(year, 0, 1);
          const daysDiff = Math.floor((taskDate - startOfYear) / (1000 * 60 * 60 * 24));
          const weekNum = Math.ceil((daysDiff + startOfYear.getDay() + 1) / 7);
          periodKey = `${year}-W${weekNum.toString().padStart(2, '0')}`;
          break;
        case 'month':
          periodKey = `${taskDate.getFullYear()}-${(taskDate.getMonth() + 1).toString().padStart(2, '0')}`;
          break;
        case 'year':
          periodKey = taskDate.getFullYear().toString();
          break;
      }

      // יצירת הרשומה אם לא קיימת
      if (!summaryData[periodKey]) {
        summaryData[periodKey] = {
          period: periodKey,
          totalTasks: 0,
          byStatus: {},
          byImportance: {},
          completionRate: 0
        };
      }

      // עדכון הספירות
      summaryData[periodKey].totalTasks++;
      
      const status = task.effectiveStatus;
      summaryData[periodKey].byStatus[status] = 
        (summaryData[periodKey].byStatus[status] || 0) + 1;
      
      summaryData[periodKey].byImportance[task.importance] = 
        (summaryData[periodKey].byImportance[task.importance] || 0) + 1;
    });

    // חישוב אחוז השלמה לכל תקופה
    Object.values(summaryData).forEach(summary => {
      const completed = summary.byStatus['הושלם'] || 0;
      summary.completionRate = summary.totalTasks > 0 ?
        Math.round((completed / summary.totalTasks) * 100) : 0;
    });

    // סטטיסטיקות כלליות
    const overallStats = {
      totalPeriods: Object.keys(summaryData).length,
      totalTasks: Object.values(summaryData).reduce((sum, item) => sum + item.totalTasks, 0),
      averageTasksPerPeriod: 0,
      averageCompletionRate: 0
    };

    if (overallStats.totalPeriods > 0) {
      overallStats.averageTasksPerPeriod = Math.round(overallStats.totalTasks / overallStats.totalPeriods);
      overallStats.averageCompletionRate = Math.round(
        Object.values(summaryData).reduce((sum, item) => sum + item.completionRate, 0) / overallStats.totalPeriods
      );
    }

    // מיון התוצאות לפי תקופה
    const sortedResults = Object.values(summaryData).sort((a, b) => a.period.localeCompare(b.period));

    res.json({
      success: true,
      data: sortedResults,
      overallStats,
      period: {
        type: period,
        start: baseFilter.createdAt?.$gte,
        end: baseFilter.createdAt?.$lte
      },
      appliedFilters: req.query
    });

  } catch (error) {
    console.error('Error in getTasksSummaryByPeriod:', error);
    res.status(500).json({ success: false, message: 'שגיאה בשליפת סיכום משימות' });
  }
};

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
        .populate('notes.user', 'firstName lastName userName');

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