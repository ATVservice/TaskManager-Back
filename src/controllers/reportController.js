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

/**
 * איפוס פילטר למשתמש
 * DELETE /api/filters/:screenType
 */
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

/**
 * קבלת כל הפילטרים של המשתמש
 * GET /api/filters/user/all
 */
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
//פונקציה אחידה לבניית פילטר
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

  console.log("*employeeId", employeeId)
  console.log("**startDate", startDate)
  console.log("***endDate", endDate)
  console.log("****importance", importance)
  console.log("*****subImportance", subImportance)
  console.log("******organization", associationId)
  console.log("*******status", status)
  console.log("********failureReason", reasonId)






  let filter = { isDeleted: { $ne: true } };

  // עובד
  if (employeeId) {
    filter.$or = [
      { creator: employeeId },
      { mainAssignee: employeeId },
      { assignees: { $in: [employeeId] } }
    ];
  }

  // טווח תאריכים
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
    .sort({ createdAt: -1 });

  // שילוב והעשרת הנתונים
  const allTasks = [];

  for (const task of regularTasks) {
    const assigneeDetails = await getAssigneeDetails(task._id, 'Task');
    allTasks.push({
      ...task.toObject(),
      daysOpen: task.daysOpen,
      taskType: 'רגילה',
      assigneeDetails
    });
  }

  for (const task of recurringTasks) {
    const assigneeDetails = await getAssigneeDetails(task._id, 'RecurringTask');
    allTasks.push({
      ...task.toObject(),
      daysOpen: task.daysOpen,
      taskType: 'קבועה',
      assigneeDetails
    });
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
// 2. דוח משימות לפי אחראים ראשיים ומשניים
export const getTasksByResponsibility = async (req, res) => {
  const {
    responsibilityType = 'all' // 'main', 'secondary', 'all'
  } = req.query;

  const userId = req.user.id;

  // שמירת פילטר
  saveUserFilter(userId, 'tasksByResponsibility', req.query);

  // בניית פילטר באמצעות הפונקציה המרכזית - ללא employeeId
  const { employeeId, ...filterParams } = req.query;
  let baseFilter = buildTaskFilter(filterParams);

  // המרת associationId ל-ObjectId עבור aggregation
  if (baseFilter.organization) {
    baseFilter.organization = new mongoose.Types.ObjectId(baseFilter.organization);
  }

  // בניית pipeline לאגרגציה
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
  const recurringTasks = await RecurringTask.aggregate(pipeline);

  const allTasks = [...regularTasks, ...recurringTasks];

  // ארגון הנתונים לפי אחריות
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

      responsibilityReport.mainResponsible[mainKey].tasks.push({
        ...task,
        taskType: task.frequencyType ? 'קבועה' : 'רגילה'
      });
      responsibilityReport.mainResponsible[mainKey].summary.total++;
      responsibilityReport.summary.mainAssignees.add(mainKey);

      // עדכון סיכומים
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

        responsibilityReport.secondaryResponsible[secondaryKey].tasks.push({
          ...task,
          taskType: task.frequencyType ? 'קבועה' : 'רגילה'
        });
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

  // פילטר לפי סוג אחריות
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
// 3. דוח משימות חורגות מיעד
export const getOverdueTasks = async (req, res) => {
  try {
    const {
      daysOverdue = 1, // כמה ימים באיחור לפחות
      includeNoDeadline = false // האם לכלול משימות ללא תאריך יעד
    } = req.query;

    const userId = req.user.id;

    // שמירת פילטר
    saveUserFilter(userId, 'overdueTasks', req.query);

    // בניית פילטר באמצעות הפונקציה המרכזית
    let baseFilter = buildTaskFilter(req.query);

    // פילטר למשימות שלא הושלמו - תמיד לאכוף את זה
    if (baseFilter.status) {
      // אם יש סינון סטטוס, שלב אותו עם הדרישה שלא יהיו משימות מושלמות/מבוטלות
      if (Array.isArray(baseFilter.status.$in)) {
        baseFilter.status.$in = baseFilter.status.$in.filter(s => !['הושלם', 'בוטלה'].includes(s));
      } else if (baseFilter.status !== 'הושלם' && baseFilter.status !== 'בוטלה') {
        // סטטוס בודד שאינו הושלם/בוטלה
        baseFilter.status = { $nin: ['הושלם', 'בוטלה'], $eq: baseFilter.status };
      } else {
        // אם הסטטוס שנבחר הוא הושלם/בוטלה - החזר ריק
        return res.json({ success: true, data: [], statistics: {}, appliedFilters: req.query });
      }
    } else {
      baseFilter.status = { $nin: ['הושלם', 'בוטלה'] };
    }

    // פילטר לתאריך יעד שעבר
    const now = new Date();
    const overdueDate = new Date(now.getTime() - (daysOverdue * 24 * 60 * 60 * 1000));

    if (includeNoDeadline === 'true') {
      // שמירת ה-$or הקיים אם יש
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
      delete baseFilter.$or; // מסירים את ה-$or הישן
    } else {
      baseFilter.finalDeadline = { $lt: overdueDate };
    }

    const overdueTasks = await Task.find(baseFilter)
      .populate('creator', 'firstName lastName userName')
      .populate('mainAssignee', 'firstName lastName userName')
      .populate('assignees', 'firstName lastName userName')
      .populate('organization', 'name')
      .sort({ finalDeadline: 1 }); // מיון לפי תאריך יעד (הישנים ראשון)

    // חישוב מידע נוסף לכל משימה
    const enrichedTasks = await Promise.all(overdueTasks.map(async (task) => {
      const assigneeDetails = await getAssigneeDetails(task._id, 'Task');

      let daysOverdueCount = 0;
      if (task.finalDeadline) {
        daysOverdueCount = Math.floor((now - new Date(task.finalDeadline)) / (1000 * 60 * 60 * 24));
      }

      return {
        ...task.toObject(),
        daysOverdue: daysOverdueCount,
        daysOpen: task.daysOpen,
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
      // לפי חשיבות
      statistics.byImportance[task.importance] =
        (statistics.byImportance[task.importance] || 0) + 1;

      // לפי עובד
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
export const getTasksSummaryByPeriod = async (req, res) => {
  try {
    const {
      period = 'month' // 'week', 'month', 'year'
    } = req.query;

    const userId = req.user.id;

    // שמירת פילטר
    saveUserFilter(userId, 'tasksSummary', req.query);

    // בניית פילטר באמצעות הפונקציה המרכזית
    let baseFilter = buildTaskFilter(req.query);

    // המרת associationId ל-ObjectId עבור aggregation
    if (baseFilter.organization) {
      baseFilter.organization = new mongoose.Types.ObjectId(baseFilter.organization);
    }

    // המרת employeeId fields לפני aggregation
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
    // קביעת טווח תאריכים (רק אם לא הוגדר טווח מותאם אישית)
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

    // אגרגציה לקבלת נתונים מקובצים
    const summaryPipeline = [
      { $match: baseFilter },
      {
        $group: {
          _id: {
            period: {
              $dateToString: {
                format: period === 'week' ? "%Y-%U" : period === 'month' ? "%Y-%m" : "%Y",
                date: "$createdAt"
              }
            },
            status: "$status",
            importance: "$importance"
          },
          count: { $sum: 1 },
          tasks: { $push: "$$ROOT" }
        }
      },
      {
        $group: {
          _id: "$_id.period",
          totalTasks: { $sum: "$count" },
          byStatus: {
            $push: {
              status: "$_id.status",
              count: "$count"
            }
          },
          byImportance: {
            $push: {
              importance: "$_id.importance",
              count: "$count"
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ];

    const regularTasksSummary = await Task.aggregate(summaryPipeline);
    const recurringTasksSummary = await RecurringTask.aggregate(summaryPipeline);

    // שילוב הנתונים
    const combinedSummary = {};
    [...regularTasksSummary, ...recurringTasksSummary].forEach(item => {
      const periodKey = item._id;
      if (!combinedSummary[periodKey]) {
        combinedSummary[periodKey] = {
          period: periodKey,
          totalTasks: 0,
          byStatus: {},
          byImportance: {},
          completionRate: 0
        };
      }

      combinedSummary[periodKey].totalTasks += item.totalTasks;

      item.byStatus.forEach(statusItem => {
        combinedSummary[periodKey].byStatus[statusItem.status] =
          (combinedSummary[periodKey].byStatus[statusItem.status] || 0) + statusItem.count;
      });

      item.byImportance.forEach(importanceItem => {
        combinedSummary[periodKey].byImportance[importanceItem.importance] =
          (combinedSummary[periodKey].byImportance[importanceItem.importance] || 0) + importanceItem.count;
      });
    });

    // חישוב אחוז השלמה
    Object.values(combinedSummary).forEach(summary => {
      const completed = summary.byStatus['הושלם'] || 0;
      summary.completionRate = summary.totalTasks > 0 ?
        Math.round((completed / summary.totalTasks) * 100) : 0;
    });

    // סטטיסטיקות כלליות
    const overallStats = {
      totalPeriods: Object.keys(combinedSummary).length,
      totalTasks: Object.values(combinedSummary).reduce((sum, item) => sum + item.totalTasks, 0),
      averageTasksPerPeriod: 0,
      averageCompletionRate: 0
    };

    if (overallStats.totalPeriods > 0) {
      overallStats.averageTasksPerPeriod = Math.round(overallStats.totalTasks / overallStats.totalPeriods);
      overallStats.averageCompletionRate = Math.round(
        Object.values(combinedSummary).reduce((sum, item) => sum + item.completionRate, 0) / overallStats.totalPeriods
      );
    }

    res.json({
      success: true,
      data: Object.values(combinedSummary),
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
// 5. סטטיסטיקה אישית לעובד
const calculatePercentage = (achieved, total) => total > 0 ? Math.round((achieved / total) * 100) : 0;

export const getEmployeePersonalStats = async (req, res) => {
  try {
    const userId = req.user.id;

    // שמירת פילטר
    saveUserFilter(userId, 'employeePersonalStats', req.query);

    // בניית פילטר באמצעות הפונקציה המרכזית
    const taskFilter = buildTaskFilter(req.query);

    // שליפת כל העובדים או עובד ספציפי
    let employeesQuery = { role: 'עובד' };
    if (req.query.employeeId) {
      employeesQuery._id = req.query.employeeId;
    }

    const employees = await User.find(employeesQuery);

    const employeeStats = await Promise.all(employees.map(async (employee) => {
      const empId = employee._id.toString();

      // שילוב פילטר העובד עם הפילטרים האחרים
      const baseFilter = {
        ...taskFilter,
        $or: [
          { creator: empId },
          { mainAssignee: empId },
          { assignees: { $in: [empId] } }
        ]
      };

      const tasks = await Task.find(baseFilter);
      const recurringTasks = await RecurringTask.find(baseFilter);
      const allTasks = [...tasks, ...recurringTasks];

      const totalTasks = allTasks.length;
      const completedTasks = allTasks.filter(t => t.status === 'הושלם').length;
      const overdueTasks = allTasks.filter(t =>
        t.finalDeadline &&
        new Date(t.finalDeadline) < new Date() &&
        t.status !== 'הושלם'
      ).length;

      const completionRate = calculatePercentage(completedTasks, totalTasks);
      const onTimeRate = calculatePercentage(totalTasks - overdueTasks, totalTasks);

      // שליפת יעדים אישיים ויעדים כלליים
      const personalGoals = await Goal.find({ targetType: 'עובד בודד', employee: empId });
      const generalGoals = await Goal.find({ targetType: 'כלל העובדים' });

      // חישוב אחוז עמידה ביעדים (כולל אישי + כללי)
      const allGoals = [...personalGoals, ...generalGoals];
      let totalGoalTarget = 0;
      let totalGoalAchieved = 0;

      allGoals.forEach(goal => {
        const achievedCount = allTasks.filter(task =>
          task.importance === goal.importance &&
          (!goal.subImportance || task.subImportance === goal.subImportance) &&
          task.status === 'הושלם'
        ).length;

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
        overallGoalPercentage
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

// // אחסון פילטרים לפי משתמש
// const userFilters = new Map();

// // פונקציית עזר לשמירת פילטר
// const saveUserFilter = (userId, screenType, filters) => {
//   const userKey = `${userId}_${screenType}`;
//   userFilters.set(userKey, filters);
// };

// // פונקציית עזר לטעינת פילטר
// const loadUserFilter = (userId, screenType) => {
//   const userKey = `${userId}_${screenType}`;
//   return userFilters.get(userKey) || {};
// };

// // 7. טעינת פילטר שמור למשתמש
// export const loadSavedFilter = async (req, res) => {
//   try {
//     const { screenType } = req.params;
//     const userId = req.user.id;

//     const savedFilter = loadUserFilter(userId, screenType);

//     res.json({
//       success: true,
//       filter: savedFilter
//     });

//   } catch (error) {
//     console.error('Error in loadSavedFilter:', error);
//     res.status(500).json({ success: false, message: 'שגיאה בטעינת פילטר שמור' });
//   }
// };

// // 8. איפוס פילטר
// export const resetFilter = async (req, res) => {
//   try {
//     const { screenType } = req.params;
//     const userId = req.user.id;

//     const userKey = `${userId}_${screenType}`;
//     userFilters.delete(userKey);

//     res.json({
//       success: true,
//       message: 'הפילטר אופס בהצלחה'
//     });

//   } catch (error) {
//     console.error('Error in resetFilter:', error);
//     res.status(500).json({ success: false, message: 'שגיאה באיפוס פילטר' });
//   }
// };

