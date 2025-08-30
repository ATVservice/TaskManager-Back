import mongoose from 'mongoose';
import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';
import User from '../models/User.js';
import Association from '../models/Association.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import Goal from '../models/Goal.js';

// אחסון פילטרים לפי משתמש
const userFilters = new Map();

// פונקציית עזר לשמירת פילטר
const saveUserFilter = (userId, screenType, filters) => {
  const userKey = `${userId}_${screenType}`;
  userFilters.set(userKey, filters);
};

// פונקציית עזר לטעינת פילטר
const loadUserFilter = (userId, screenType) => {
  const userKey = `${userId}_${screenType}`;
  return userFilters.get(userKey) || {};
};

// פונקציית עזר לבניית פילטר בסיסי לפי הרשאות
const buildBaseFilter = (userId, userRole) => {
  let baseFilter = { isDeleted: { $ne: true } };
  
  // אם זה לא מנהל, הוסף פילטר לראות רק משימות שהוא קשור אליהן
  if (userRole !== 'מנהל') {
    baseFilter.$or = [
      { creator: userId },
      { mainAssignee: userId },
      { assignees: { $in: [userId] } }
    ];
  }
  
  return baseFilter;
};

// פונקציית עזר לקבלת פרטי assignee
const getAssigneeDetails = async (taskId, taskModel, userId = null) => {
  const query = { taskId, taskModel };
  if (userId) query.user = userId;
  
  return await TaskAssigneeDetails.find(query).populate('user', 'firstName lastName userName');
};
//!!!!!!!!!!!!!!!!!!!!!!!לבטל
// פונקציית עזר לחישוב ימים פתוחים
const calculateDaysOpen = (createdAt) => {
  const now = new Date();
  const created = new Date(createdAt);
  return Math.floor((now - created) / (1000 * 60 * 60 * 24));
};

// 1. דוח משימות פתוחות לפי עובד
export const getOpenTasksByEmployee = async (req, res) => {
  try {
    const { 
      employeeId, 
      startDate, 
      endDate, 
      importance, 
      subImportance, 
      organization, 
      project,
      status = ['בתהליך', 'מושהה', 'בטיפול'] 
    } = req.query;
    
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // שמירת פילטר
    saveUserFilter(userId, 'openTasks', req.query);
    
    let baseFilter = buildBaseFilter(userId, userRole);
    
    // הוספת פילטרים ספציפיים
    if (employeeId) {
      baseFilter.$or = [
        { creator: employeeId },
        { mainAssignee: employeeId },
        { assignees: { $in: [employeeId] } }
      ];
    }
    
    if (startDate && endDate) {
      baseFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    if (importance) baseFilter.importance = importance;
    if (subImportance) baseFilter.subImportance = subImportance;
    if (organization) baseFilter.organization = organization;
    if (project) baseFilter.project = new RegExp(project, 'i');
    if (status && status.length > 0) {
      baseFilter.status = Array.isArray(status) ? { $in: status } : status;
    }
    
    // חיפוש במשימות רגילות
    const regularTasks = await Task.find(baseFilter)
      .populate('creator', 'firstName lastName userName')
      .populate('mainAssignee', 'firstName lastName userName')
      .populate('assignees', 'firstName lastName userName')
      .populate('organization', 'name')
      .sort({ createdAt: -1 });
    
    // חיפוש במשימות קבועות
    const recurringTasks = await RecurringTask.find({
      ...baseFilter,
      status: { $in: status }
    })
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
        daysOpen: calculateDaysOpen(task.createdAt),
        taskType: 'רגילה',
        assigneeDetails
      });
    }
    
    for (const task of recurringTasks) {
      const assigneeDetails = await getAssigneeDetails(task._id, 'RecurringTask');
      allTasks.push({
        ...task.toObject(),
        daysOpen: calculateDaysOpen(task.createdAt),
        taskType: 'קבועה',
        assigneeDetails
      });
    }
    
    // קיבוץ לפי עובדים
    const tasksByEmployee = {};
    
    allTasks.forEach(task => {
      const employees = [
        { id: task.creator._id, name: `${task.creator.firstName} ${task.creator.lastName}`, role: 'יוצר' },
        { id: task.mainAssignee._id, name: `${task.mainAssignee.firstName} ${task.mainAssignee.lastName}`, role: 'אחראי ראשי' }
      ];
      
      task.assignees.forEach(assignee => {
        if (assignee._id.toString() !== task.mainAssignee._id.toString()) {
          employees.push({ 
            id: assignee._id, 
            name: `${assignee.firstName} ${assignee.lastName}`, 
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
              overdue: 0
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
    
    res.json({
      success: true,
      data: Object.values(tasksByEmployee),
      totalTasks: allTasks.length,
      appliedFilters: req.query
    });
    
  } catch (error) {
    console.error('Error in getOpenTasksByEmployee:', error);
    res.status(500).json({ success: false, message: 'שגיאה בשליפת דוח משימות פתוחות' });
  }
};

// 2. דוח משימות לפי אחראים ראשיים ומשניים
export const getTasksByResponsibility = async (req, res) => {
  try {
    const { 
      responsibilityType = 'all', // 'main', 'secondary', 'all'
      employeeId,
      startDate,
      endDate,
      importance,
      organization,
      status
    } = req.query;
    
    const userId = req.user.id;
    const userRole = req.user.role;
    
    saveUserFilter(userId, 'tasksByResponsibility', req.query);
    
    let baseFilter = buildBaseFilter(userId, userRole);
    
    // הוספת פילטרים
    if (startDate && endDate) {
      baseFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    if (importance) baseFilter.importance = importance;
    if (organization) baseFilter.organization = organization;
    if (status) baseFilter.status = Array.isArray(status) ? { $in: status } : status;
    
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
      if (mainAssignee && (!employeeId || mainAssignee._id.toString() === employeeId)) {
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
      }
      
      // אחראים משניים
      assignees.forEach(assignee => {
        if (assignee._id.toString() !== task.mainAssignee.toString() && 
            (!employeeId || assignee._id.toString() === employeeId)) {
          
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
    
  } catch (error) {
    console.error('Error in getTasksByResponsibility:', error);
    res.status(500).json({ success: false, message: 'שגיאה בשליפת דוח אחריות' });
  }
};

// 3. דוח משימות חורגות מיעד
export const getOverdueTasks = async (req, res) => {
  try {
    const { 
      employeeId,
      organization,
      importance,
      daysOverdue = 1, // כמה ימים באיחור לפחות
      includeNoDeadline = false // האם לכלול משימות ללא תאריך יעד
    } = req.query;
    
    const userId = req.user.id;
    const userRole = req.user.role;
    
    saveUserFilter(userId, 'overdueTasks', req.query);
    
    let baseFilter = buildBaseFilter(userId, userRole);
    
    // פילטר למשימות שלא הושלמו
    baseFilter.status = { $nin: ['הושלם', 'בוטלה'] };
    
    // פילטר לתאריך יעד שעבר
    const now = new Date();
    const overdueDate = new Date(now.getTime() - (daysOverdue * 24 * 60 * 60 * 1000));
    
    if (includeNoDeadline === 'true') {
      baseFilter.$or = [
        { finalDeadline: { $lt: overdueDate } },
        { finalDeadline: { $exists: false } },
        { finalDeadline: null }
      ];
    } else {
      baseFilter.finalDeadline = { $lt: overdueDate };
    }
    
    if (employeeId) {
      baseFilter.$and = [
        baseFilter.$and || {},
        {
          $or: [
            { creator: employeeId },
            { mainAssignee: employeeId },
            { assignees: { $in: [employeeId] } }
          ]
        }
      ];
    }
    
    if (organization) baseFilter.organization = organization;
    if (importance) baseFilter.importance = importance;
    
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
        daysOpen: calculateDaysOpen(task.createdAt),
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

// 4. סיכום משימות לפי שבוע/חודש
export const getTasksSummaryByPeriod = async (req, res) => {
  try {
    const { 
      period = 'week', // 'week', 'month', 'year'
      startDate,
      endDate,
      employeeId,
      organization,
      importance
    } = req.query;
    
    const userId = req.user.id;
    const userRole = req.user.role;
    
    saveUserFilter(userId, 'tasksSummary', req.query);
    
    let baseFilter = buildBaseFilter(userId, userRole);
    
    // קביעת טווח תאריכים אם לא סופק
    let periodStart, periodEnd;
    if (startDate && endDate) {
      periodStart = new Date(startDate);
      periodEnd = new Date(endDate);
    } else {
      const now = new Date();
      switch (period) {
        case 'week':
          periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'year':
          periodStart = new Date(now.getFullYear(), 0, 1);
          break;
      }
      periodEnd = now;
    }
    
    baseFilter.createdAt = {
      $gte: periodStart,
      $lte: periodEnd
    };
    
    if (employeeId) {
      baseFilter.$or = [
        { creator: employeeId },
        { mainAssignee: employeeId },
        { assignees: { $in: [employeeId] } }
      ];
    }
    
    if (organization) baseFilter.organization = organization;
    if (importance) baseFilter.importance = importance;
    
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
      const period = item._id;
      if (!combinedSummary[period]) {
        combinedSummary[period] = {
          period,
          totalTasks: 0,
          byStatus: {},
          byImportance: {},
          completionRate: 0
        };
      }
      
      combinedSummary[period].totalTasks += item.totalTasks;
      
      item.byStatus.forEach(statusItem => {
        combinedSummary[period].byStatus[statusItem.status] = 
          (combinedSummary[period].byStatus[statusItem.status] || 0) + statusItem.count;
      });
      
      item.byImportance.forEach(importanceItem => {
        combinedSummary[period].byImportance[importanceItem.importance] = 
          (combinedSummary[period].byImportance[importanceItem.importance] || 0) + importanceItem.count;
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
        start: periodStart,
        end: periodEnd
      },
      appliedFilters: req.query
    });
    
  } catch (error) {
    console.error('Error in getTasksSummaryByPeriod:', error);
    res.status(500).json({ success: false, message: 'שגיאה בשליפת סיכום משימות' });
  }
};

// 5. סטטיסטיקה אישית לעובד
export const getEmployeePersonalStats = async (req, res) => {
  try {
    const { employeeId, period = 'month' } = req.query;
    const targetEmployeeId = employeeId || req.user.id;
    
    const userId = req.user.id;
    
    saveUserFilter(userId, 'personalStats', req.query);
    
    // קביעת טווח תאריכים
    const now = new Date();
    let startDate;
    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
    }
    
    // בניית פילטר בסיסי
    const baseFilter = {
      isDeleted: { $ne: true },
      $or: [
        { creator: targetEmployeeId },
        { mainAssignee: targetEmployeeId },
        { assignees: { $in: [targetEmployeeId] } }
      ]
    };
    
    if (startDate) {
      baseFilter.createdAt = { $gte: startDate };
    }
    
    // שליפת משימות
    const tasks = await Task.find(baseFilter)
      .populate('organization', 'name')
      .sort({ createdAt: -1 });
    
    const recurringTasks = await RecurringTask.find(baseFilter)
      .populate('organization', 'name')
      .sort({ createdAt: -1 });
    
    const allTasks = [...tasks, ...recurringTasks];
    
    // שליפת פרטי assignee עבור המשתמש הספציפי
    const assigneeDetailsPromises = allTasks.map(async (task) => {
      const details = await getAssigneeDetails(
        task._id, 
        task.frequencyType ? 'RecurringTask' : 'Task',
        targetEmployeeId
      );
      return { task, details: details[0] || null };
    });
    
    const tasksWithDetails = await Promise.all(assigneeDetailsPromises);
    
    // חישוב סטטיסטיקות
    const stats = {
      overview: {
        totalTasks: allTasks.length,
        completed: 0,
        inProgress: 0,
        overdue: 0,
        completionRate: 0
      },
      byRole: {
        asCreator: 0,
        asMainAssignee: 0,
        asSecondaryAssignee: 0
      },
      byImportance: {},
      byStatus: {},
      byOrganization: {},
      recentActivity: [],
      goals: {
        daily: [],
        weekly: [],
        monthly: []
      }
    };
    
    const now_ts = now.getTime();
    
    allTasks.forEach(task => {
      // ספירה כללית
      if (task.status === 'הושלם') stats.overview.completed++;
      if (task.status === 'בתהליך') stats.overview.inProgress++;
      if (task.finalDeadline && new Date(task.finalDeadline).getTime() < now_ts && task.status !== 'הושלם') {
        stats.overview.overdue++;
      }
      
      // לפי תפקיד
      if (task.creator.toString() === targetEmployeeId) stats.byRole.asCreator++;
      if (task.mainAssignee.toString() === targetEmployeeId) stats.byRole.asMainAssignee++;
      if (task.assignees.some(id => id.toString() === targetEmployeeId) && 
          task.mainAssignee.toString() !== targetEmployeeId) {
        stats.byRole.asSecondaryAssignee++;
      }
      
      // לפי חשיבות וסטטוס
      stats.byImportance[task.importance] = (stats.byImportance[task.importance] || 0) + 1;
      stats.byStatus[task.status] = (stats.byStatus[task.status] || 0) + 1;
      
      // לפי ארגון
      const orgName = task.organization?.name || 'ללא ארגון';
      stats.byOrganization[orgName] = (stats.byOrganization[orgName] || 0) + 1;
    });
    
    // חישוב אחוז השלמה
    stats.overview.completionRate = stats.overview.totalTasks > 0 ? 
      Math.round((stats.overview.completed / stats.overview.totalTasks) * 100) : 0;
    
    // פעילות אחרונה (10 משימות אחרונות)
    stats.recentActivity = tasksWithDetails
      .sort((a, b) => new Date(b.task.updatedAt) - new Date(a.task.updatedAt))
      .slice(0, 10)
      .map(item => ({
        taskId: item.task.taskId,
        title: item.task.title,
        status: item.details?.status || item.task.status,
        updatedAt: item.task.updatedAt,
        importance: item.task.importance,
        organization: item.task.organization?.name
      }));
    
    // שליפת יעדים אישיים
    const personalGoals = await Goal.find({
      $or: [
        { targetType: 'עובד בודד', employee: targetEmployeeId },
        { targetType: 'כלל העובדים' }
      ]
    });
    
    // חישוב התקדמות ביעדים
    for (const goal of personalGoals) {
      const goalPeriodStart = getGoalPeriodStart(goal.frequency);
      const relevantTasks = allTasks.filter(task => {
        return task.createdAt >= goalPeriodStart &&
               task.importance === goal.importance &&
               (!goal.subImportance || task.subImportance === goal.subImportance) &&
               task.status === 'הושלם';
      });
      
      const progress = {
        goal: goal.targetCount,
        achieved: relevantTasks.length,
        percentage: Math.round((relevantTasks.length / goal.targetCount) * 100),
        importance: goal.importance,
        subImportance: goal.subImportance,
        frequency: goal.frequency
      };
      
      stats.goals[goal.frequency].push(progress);
    }
    
    res.json({
      success: true,
      employee: {
        id: targetEmployeeId,
        // נשלוף פרטי העובד
      },
      period: {
        type: period,
        start: startDate,
        end: now
      },
      stats,
      appliedFilters: req.query
    });
    
  } catch (error) {
    console.error('Error in getEmployeePersonalStats:', error);
    res.status(500).json({ success: false, message: 'שגיאה בשליפת סטטיסטיקות אישיות' });
  }
};

// פונקציית עזר לחישוב תחילת תקופת יעד
const getGoalPeriodStart = (frequency) => {
  const now = new Date();
  switch (frequency) {
    case 'daily':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'weekly':
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      return startOfWeek;
    case 'monthly':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    default:
      return new Date(now.getFullYear(), now.getMonth(), 1);
  }
};

// 6. דוח משימות לפי סיבת אי-ביצוע
export const getTasksByFailureReason = async (req, res) => {
  try {
    const { 
      startDate,
      endDate,
      employeeId,
      organization,
      failureReason
    } = req.query;
    
    const userId = req.user.id;
    const userRole = req.user.role;
    
    saveUserFilter(userId, 'failureReasons', req.query);
    
    let baseFilter = buildBaseFilter(userId, userRole);
    
    // רק משימות עם סיבת אי-ביצוע
    baseFilter.failureReason = { $exists: true, $ne: null, $ne: "" };
    
    if (startDate && endDate) {
      baseFilter.updatedAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    if (employeeId) {
      baseFilter.$or = [
        { creator: employeeId },
        { mainAssignee: employeeId },
        { assignees: { $in: [employeeId] } }
      ];
    }
    
    if (organization) baseFilter.organization = organization;
    if (failureReason) baseFilter.failureReason = new RegExp(failureReason, 'i');
    
    const tasksWithFailures = await Task.find(baseFilter)
      .populate('creator', 'firstName lastName userName')
      .populate('mainAssignee', 'firstName lastName userName')
      .populate('assignees', 'firstName lastName userName')
      .populate('organization', 'name')
      .sort({ updatedAt: -1 });
    
    // קיבוץ לפי סיבת אי-ביצוע
    const failureAnalysis = {};
    const employeeFailures = {};
    
    tasksWithFailures.forEach(task => {
      const reason = task.failureReason;
      
      // קיבוץ לפי סיבה
      if (!failureAnalysis[reason]) {
        failureAnalysis[reason] = {
          reason,
          count: 0,
          tasks: [],
          employees: new Set(),
          organizations: new Set()
        };
      }
      
      failureAnalysis[reason].count++;
      failureAnalysis[reason].tasks.push(task);
      failureAnalysis[reason].employees.add(`${task.mainAssignee.firstName} ${task.mainAssignee.lastName}`);
      failureAnalysis[reason].organizations.add(task.organization.name);
      
      // קיבוץ לפי עובד
      const employeeName = `${task.mainAssignee.firstName} ${task.mainAssignee.lastName}`;
      if (!employeeFailures[employeeName]) {
        employeeFailures[employeeName] = {
          employee: employeeName,
          employeeId: task.mainAssignee._id,
          totalFailures: 0,
          byReason: {},
          tasks: []
        };
      }
      
      employeeFailures[employeeName].totalFailures++;
      employeeFailures[employeeName].byReason[reason] = 
        (employeeFailures[employeeName].byReason[reason] || 0) + 1;
      employeeFailures[employeeName].tasks.push(task);
    });
    
    // המרת Set לאריי בניתוח הכשלים
    Object.values(failureAnalysis).forEach(analysis => {
      analysis.employees = Array.from(analysis.employees);
      analysis.organizations = Array.from(analysis.organizations);
    });
    
    // סיכום סטטיסטי
    const summary = {
      totalTasksWithFailures: tasksWithFailures.length,
      totalUniqueReasons: Object.keys(failureAnalysis).length,
      topReasons: Object.values(failureAnalysis)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(item => ({ reason: item.reason, count: item.count })),
      employeesWithMostFailures: Object.values(employeeFailures)
        .sort((a, b) => b.totalFailures - a.totalFailures)
        .slice(0, 5)
        .map(item => ({ employee: item.employee, failures: item.totalFailures }))
    };
    
    res.json({
      success: true,
      data: {
        byReason: Object.values(failureAnalysis),
        byEmployee: Object.values(employeeFailures),
        summary
      },
      appliedFilters: req.query
    });
    
  } catch (error) {
    console.error('Error in getTasksByFailureReason:', error);
    res.status(500).json({ success: false, message: 'שגיאה בשליפת דוח סיבות אי-ביצוע' });
  }
};

// 7. טעינת פילטר שמור למשתמש
export const loadSavedFilter = async (req, res) => {
  try {
    const { screenType } = req.params;
    const userId = req.user.id;
    
    const savedFilter = loadUserFilter(userId, screenType);
    
    res.json({
      success: true,
      filter: savedFilter
    });
    
  } catch (error) {
    console.error('Error in loadSavedFilter:', error);
    res.status(500).json({ success: false, message: 'שגיאה בטעינת פילטר שמור' });
  }
};

// 8. איפוס פילטר
export const resetFilter = async (req, res) => {
  try {
    const { screenType } = req.params;
    const userId = req.user.id;
    
    const userKey = `${userId}_${screenType}`;
    userFilters.delete(userKey);
    
    res.json({
      success: true,
      message: 'הפילטר אופס בהצלחה'
    });
    
  } catch (error) {
    console.error('Error in resetFilter:', error);
    res.status(500).json({ success: false, message: 'שגיאה באיפוס פילטר' });
  }
};

