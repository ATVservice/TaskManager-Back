// import Task from '../models/Task.js';
// import User from '../models/User.js';
// import Association from '../models/Association.js';
// import Goal from '../models/Goal.js'; // נדרש למודל יעדים
// import moment from 'moment';
// import PDFDocument from 'pdfkit';
// import ExcelJS from 'exceljs';
// import NodeCache from 'node-cache';

// // Cache לדוחות כבדים - 5 דקות
// const reportsCache = new NodeCache({ stdTTL: 300 });

// // =========== פונקציות עזר ===========

// // בניית stage לסינון MongoDB
// const buildMatchStage = (query) => {
//     const matchStage = { isDeleted: { $ne: true } };
    
//     // סינון לפי עובד (ראשי או משני)
//     if (query.employeeId) {
//         if (query.employeeRole === 'main') {
//             matchStage.mainAssignee = query.employeeId;
//         } else if (query.employeeRole === 'secondary') {
//             matchStage.assignees = query.employeeId;
//         } else {
//             // שניהם
//             matchStage.$or = [
//                 { mainAssignee: query.employeeId },
//                 { assignees: query.employeeId }
//             ];
//         }
//     }
    
//     // סינון לפי עמותה
//     if (query.organizationId) {
//         if (Array.isArray(query.organizationId)) {
//             matchStage.organization = { $in: query.organizationId };
//         } else {
//             matchStage.organization = query.organizationId;
//         }
//     }
    
//     // סינון לפי סטטוס
//     if (query.status) {
//         if (Array.isArray(query.status)) {
//             matchStage.status = { $in: query.status };
//         } else {
//             matchStage.status = query.status;
//         }
//     }
    
//     // סינון לפי רמת חשיבות
//     if (query.importance) {
//         if (Array.isArray(query.importance)) {
//             matchStage.importance = { $in: query.importance };
//         } else {
//             matchStage.importance = query.importance;
//         }
//     }
    
//     // סינון לפי תת-סיווג (למיידי)
//     if (query.subCategory) {
//         matchStage.subCategory = query.subCategory;
//     }
    
//     // סינון לפי סיבת אי-ביצוע
//     if (query.failureReason) {
//         matchStage.failureReason = query.failureReason;
//     }
    
//     // סינון לפי פרויקט
//     if (query.project) {
//         matchStage.project = query.project;
//     }
    
//     // סינון לפי טווח תאריכים
//     if (query.startDate && query.endDate) {
//         matchStage.createdAt = {
//             $gte: new Date(query.startDate),
//             $lte: new Date(query.endDate)
//         };
//     }
    
//     // סינון לפי תאריך יעד
//     if (query.dueDateStart && query.dueDateEnd) {
//         matchStage.dueDate = {
//             $gte: new Date(query.dueDateStart),
//             $lte: new Date(query.dueDateEnd)
//         };
//     }
    
//     // סינון לפי Task ID
//     if (query.taskId) {
//         matchStage.taskId = parseInt(query.taskId);
//     }
    
//     return matchStage;
// };

// // פונקציית Cache
// const getCacheKey = (functionName, query) => {
//     return `report_${functionName}_${JSON.stringify(query)}`;
// };

// const cacheResponse = (key, data) => {
//     reportsCache.set(key, data);
//     return data;
// };

// // =========== דוחות משימות ===========

// // 1. משימות פתוחות לפי עובד (משופר)
// export const openTasksByEmployee = async (req, res) => {
//     try {
//         const { format = 'json' } = req.query;
//         const cacheKey = getCacheKey('openTasksByEmployee', req.query);
//         const cachedResult = reportsCache.get(cacheKey);
        
//         if (cachedResult && format === 'json') {
//             return res.json(cachedResult);
//         }

//         const matchStage = buildMatchStage(req.query);
//         // רק משימות פתוחות
//         matchStage.status = { $nin: ['הושלם', 'בוטלה'] };

//         const pipeline = [
//             { $match: matchStage },
//             {
//                 $lookup: {
//                     from: 'users',
//                     localField: 'mainAssignee',
//                     foreignField: '_id',
//                     as: 'mainAssigneeDetails'
//                 }
//             },
//             {
//                 $lookup: {
//                     from: 'users',
//                     localField: 'assignees',
//                     foreignField: '_id',
//                     as: 'assigneesDetails'
//                 }
//             },
//             {
//                 $lookup: {
//                     from: 'associations',
//                     localField: 'organization',
//                     foreignField: '_id',
//                     as: 'organizationDetails'
//                 }
//             },
//             {
//                 $group: {
//                     _id: '$mainAssignee',
//                     employeeName: { $first: { $arrayElemAt: ['$mainAssigneeDetails.userName', 0] } },
//                     employeeEmail: { $first: { $arrayElemAt: ['$mainAssigneeDetails.email', 0] } },
//                     totalTasks: { $sum: 1 },
//                     urgentTasks: {
//                         $sum: { $cond: [{ $eq: ['$importance', 'מיידי'] }, 1, 0] }
//                     },
//                     drawerTasks: {
//                         $sum: { $cond: [{ $eq: ['$importance', 'מגירה'] }, 1, 0] }
//                     },
//                     generalTasks: {
//                         $sum: { $cond: [{ $eq: ['$importance', 'כללי'] }, 1, 0] }
//                     },
//                     overdueTasks: {
//                         $sum: {
//                             $cond: [
//                                 { $lt: ['$dueDate', new Date()] },
//                                 1, 0
//                             ]
//                         }
//                     },
//                     inProgressTasks: {
//                         $sum: { $cond: [{ $eq: ['$status', 'בתהליך'] }, 1, 0] }
//                     },
//                     pendingTasks: {
//                         $sum: { $cond: [{ $eq: ['$status', 'מושהה'] }, 1, 0] }
//                     },
//                     tasks: {
//                         $push: {
//                             taskId: '$taskId',
//                             title: '$title',
//                             status: '$status',
//                             importance: '$importance',
//                             subCategory: '$subCategory',
//                             dueDate: '$dueDate',
//                             organization: { $arrayElemAt: ['$organizationDetails.name', 0] },
//                             project: '$project',
//                             daysOpen: {
//                                 $floor: {
//                                     $divide: [
//                                         { $subtract: [new Date(), '$createdAt'] },
//                                         1000 * 60 * 60 * 24
//                                     ]
//                                 }
//                             },
//                             isOverdue: { $lt: ['$dueDate', new Date()] }
//                         }
//                     }
//                 }
//             },
//             { $sort: { totalTasks: -1 } }
//         ];

//         const results = await Task.aggregate(pipeline);

//         // חישוב סיכום
//         const summary = {
//             totalEmployees: results.length,
//             totalOpenTasks: results.reduce((sum, emp) => sum + emp.totalTasks, 0),
//             totalUrgentTasks: results.reduce((sum, emp) => sum + emp.urgentTasks, 0),
//             totalOverdueTasks: results.reduce((sum, emp) => sum + emp.overdueTasks, 0),
//             totalDrawerTasks: results.reduce((sum, emp) => sum + emp.drawerTasks, 0),
//             avgTasksPerEmployee: results.length ? 
//                 (results.reduce((sum, emp) => sum + emp.totalTasks, 0) / results.length).toFixed(1) : 0
//         };

//         const responseData = {
//             success: true,
//             data: results,
//             summary,
//             generatedAt: new Date(),
//             appliedFilters: req.query
//         };

//         if (format === 'pdf') {
//             return generateAdvancedPDF(res, results, 'דוח משימות פתוחות לפי עובד', 
//                 ['employeeName', 'totalTasks', 'urgentTasks', 'overdueTasks', 'drawerTasks']);
//         } else if (format === 'excel') {
//             return generateAdvancedExcel(res, results, 'משימות_פתוחות_לפי_עובד', {
//                 title: 'דוח משימות פתוחות לפי עובד',
//                 summary,
//                 columns: [
//                     { key: 'employeeName', header: 'שם העובד' },
//                     { key: 'totalTasks', header: 'סה"כ משימות' },
//                     { key: 'urgentTasks', header: 'משימות מיידיות' },
//                     { key: 'overdueTasks', header: 'משימות באיחור' },
//                     { key: 'drawerTasks', header: 'משימות מגירה' }
//                 ]
//             });
//         }

//         cacheResponse(cacheKey, responseData);
//         res.json(responseData);

//     } catch (error) {
//         console.error('שגיאה בדוח משימות פתוחות לפי עובד:', error);
//         res.status(500).json({
//             success: false,
//             message: 'שגיאה ביצירת הדוח',
//             error: error.message
//         });
//     }
// };

// // 2. דוח משימות חורגות מיעד (משופר)
// export const overdueTasks = async (req, res) => {
//     try {
//         const { format = 'json', severityDays = 30 } = req.query;
//         const cacheKey = getCacheKey('overdueTasks', req.query);
        
//         const matchStage = buildMatchStage(req.query);
//         matchStage.dueDate = { $lt: new Date() };
//         matchStage.status = { $nin: ['הושלם', 'בוטלה'] };

//         const pipeline = [
//             { $match: matchStage },
//             {
//                 $lookup: {
//                     from: 'users',
//                     localField: 'mainAssignee',
//                     foreignField: '_id',
//                     as: 'mainAssigneeDetails'
//                 }
//             },
//             {
//                 $lookup: {
//                     from: 'users',
//                     localField: 'creator',
//                     foreignField: '_id',
//                     as: 'creatorDetails'
//                 }
//             },
//             {
//                 $lookup: {
//                     from: 'associations',
//                     localField: 'organization',
//                     foreignField: '_id',
//                     as: 'organizationDetails'
//                 }
//             },
//             {
//                 $addFields: {
//                     daysOverdue: {
//                         $floor: {
//                             $divide: [
//                                 { $subtract: [new Date(), '$dueDate'] },
//                                 1000 * 60 * 60 * 24
//                             ]
//                         }
//                     },
//                     mainAssigneeName: { $arrayElemAt: ['$mainAssigneeDetails.userName', 0] },
//                     creatorName: { $arrayElemAt: ['$creatorDetails.userName', 0] },
//                     organizationName: { $arrayElemAt: ['$organizationDetails.name', 0] },
//                     severityLevel: {
//                         $switch: {
//                             branches: [
//                                 { case: { $gte: [{ $divide: [{ $subtract: [new Date(), '$dueDate'] }, 1000 * 60 * 60 * 24] }, severityDays] }, then: 'קריטי' },
//                                 { case: { $gte: [{ $divide: [{ $subtract: [new Date(), '$dueDate'] }, 1000 * 60 * 60 * 24] }, 7] }, then: 'חמור' }
//                             ],
//                             default: 'קל'
//                         }
//                     }
//                 }
//             },
//             { $sort: { daysOverdue: -1, importance: 1 } }
//         ];

//         const results = await Task.aggregate(pipeline);

//         const summary = {
//             totalOverdueTasks: results.length,
//             criticalOverdue: results.filter(task => task.severityLevel === 'קריטי').length,
//             severeOverdue: results.filter(task => task.severityLevel === 'חמור').length,
//             lightOverdue: results.filter(task => task.severityLevel === 'קל').length,
//             avgDaysOverdue: results.length ? 
//                 (results.reduce((sum, task) => sum + task.daysOverdue, 0) / results.length).toFixed(1) : 0
//         };

//         const responseData = {
//             success: true,
//             data: results,
//             summary,
//             generatedAt: new Date(),
//             appliedFilters: req.query
//         };

//         if (format === 'pdf') {
//             return generateAdvancedPDF(res, results, 'דוח משימות חורגות מיעד');
//         } else if (format === 'excel') {
//             return generateAdvancedExcel(res, results, 'משימות_חורגות_מיעד', {
//                 title: 'דוח משימות חורגות מיעד',
//                 summary
//             });
//         }

//         res.json(responseData);

//     } catch (error) {
//         console.error('שגיאה בדוח משימות חורגות מיעד:', error);
//         res.status(500).json({
//             success: false,
//             message: 'שגיאה ביצירת הדוח',
//             error: error.message
//         });
//     }
// };

// // 3. משימות לפי אחראים ראשיים ומשניים (חדש)
// export const tasksByMainAndSecondaryAssignees = async (req, res) => {
//     try {
//         const { format = 'json' } = req.query;
//         const matchStage = buildMatchStage(req.query);

//         const pipeline = [
//             { $match: matchStage },
//             {
//                 $lookup: {
//                     from: 'users',
//                     localField: 'mainAssignee',
//                     foreignField: '_id',
//                     as: 'mainAssigneeDetails'
//                 }
//             },
//             {
//                 $lookup: {
//                     from: 'users',
//                     localField: 'assignees',
//                     foreignField: '_id',
//                     as: 'assigneesDetails'
//                 }
//             },
//             {
//                 $facet: {
//                     // אחראים ראשיים
//                     mainAssignees: [
//                         {
//                             $group: {
//                                 _id: '$mainAssignee',
//                                 employeeName: { $first: { $arrayElemAt: ['$mainAssigneeDetails.userName', 0] } },
//                                 role: { $first: 'אחראי ראשי' },
//                                 totalTasks: { $sum: 1 },
//                                 completedTasks: {
//                                     $sum: { $cond: [{ $eq: ['$status', 'הושלם'] }, 1, 0] }
//                                 },
//                                 urgentTasks: {
//                                     $sum: { $cond: [{ $eq: ['$importance', 'מיידי'] }, 1, 0] }
//                                 }
//                             }
//                         }
//                     ],
//                     // אחראים משניים
//                     secondaryAssignees: [
//                         { $unwind: '$assignees' },
//                         { $match: { $expr: { $ne: ['$assignees', '$mainAssignee'] } } },
//                         {
//                             $lookup: {
//                                 from: 'users',
//                                 localField: 'assignees',
//                                 foreignField: '_id',
//                                 as: 'secondaryDetails'
//                             }
//                         },
//                         {
//                             $group: {
//                                 _id: '$assignees',
//                                 employeeName: { $first: { $arrayElemAt: ['$secondaryDetails.userName', 0] } },
//                                 role: { $first: 'אחראי משני' },
//                                 totalTasks: { $sum: 1 },
//                                 completedTasks: {
//                                     $sum: { $cond: [{ $eq: ['$status', 'הושלם'] }, 1, 0] }
//                                 },
//                                 urgentTasks: {
//                                     $sum: { $cond: [{ $eq: ['$importance', 'מיידי'] }, 1, 0] }
//                                 }
//                             }
//                         }
//                     ]
//                 }
//             }
//         ];

//         const results = await Task.aggregate(pipeline);
//         const [{ mainAssignees, secondaryAssignees }] = results;

//         // שילוב התוצאות עם חישוב אחוזי השלמה
//         const processedResults = {
//             mainAssignees: mainAssignees.map(assignee => ({
//                 ...assignee,
//                 completionRate: assignee.totalTasks ? 
//                     ((assignee.completedTasks / assignee.totalTasks) * 100).toFixed(1) : 0
//             })),
//             secondaryAssignees: secondaryAssignees.map(assignee => ({
//                 ...assignee,
//                 completionRate: assignee.totalTasks ? 
//                     ((assignee.completedTasks / assignee.totalTasks) * 100).toFixed(1) : 0
//             }))
//         };

//         const responseData = {
//             success: true,
//             data: processedResults,
//             summary: {
//                 totalMainAssignees: mainAssignees.length,
//                 totalSecondaryAssignees: secondaryAssignees.length,
//                 mainAssigneesTasksTotal: mainAssignees.reduce((sum, a) => sum + a.totalTasks, 0),
//                 secondaryAssigneesTasksTotal: secondaryAssignees.reduce((sum, a) => sum + a.totalTasks, 0)
//             },
//             generatedAt: new Date(),
//             appliedFilters: req.query
//         };

//         if (format === 'pdf' || format === 'excel') {
//             const flatResults = [
//                 ...processedResults.mainAssignees,
//                 ...processedResults.secondaryAssignees
//             ];
            
//             if (format === 'pdf') {
//                 return generateAdvancedPDF(res, flatResults, 'דוח משימות לפי אחראים ראשיים ומשניים');
//             } else {
//                 return generateAdvancedExcel(res, flatResults, 'משימות_לפי_אחראים', {
//                     title: 'דוח משימות לפי אחראים ראשיים ומשניים'
//                 });
//             }
//         }

//         res.json(responseData);

//     } catch (error) {
//         console.error('שגיאה בדוח משימות לפי אחראים:', error);
//         res.status(500).json({
//             success: false,
//             message: 'שגיאה ביצירת הדוח',
//             error: error.message
//         });
//     }
// };

// // 4. דוח משימות מגירה (חדש)
// export const drawerTasksReport = async (req, res) => {
//     try {
//         const { format = 'json' } = req.query;
//         const matchStage = buildMatchStage(req.query);
//         matchStage.importance = 'מגירה';

//         const pipeline = [
//             { $match: matchStage },
//             {
//                 $lookup: {
//                     from: 'users',
//                     localField: 'mainAssignee',
//                     foreignField: '_id',
//                     as: 'mainAssigneeDetails'
//                 }
//             },
//             {
//                 $lookup: {
//                     from: 'associations',
//                     localField: 'organization',
//                     foreignField: '_id',
//                     as: 'organizationDetails'
//                 }
//             },
//             {
//                 $addFields: {
//                     daysInDrawer: {
//                         $floor: {
//                             $divide: [
//                                 { $subtract: [new Date(), '$createdAt'] },
//                                 1000 * 60 * 60 * 24
//                             ]
//                         }
//                     },
//                     mainAssigneeName: { $arrayElemAt: ['$mainAssigneeDetails.userName', 0] },
//                     organizationName: { $arrayElemAt: ['$organizationDetails.name', 0] }
//                 }
//             },
//             { $sort: { daysInDrawer: -1 } }
//         ];

//         const results = await Task.aggregate(pipeline);

//         const summary = {
//             totalDrawerTasks: results.length,
//             completedDrawerTasks: results.filter(task => task.status === 'הושלם').length,
//             activeDrawerTasks: results.filter(task => !['הושלם', 'בוטלה'].includes(task.status)).length,
//             avgDaysInDrawer: results.length ?
//                 (results.reduce((sum, task) => sum + task.daysInDrawer, 0) / results.length).toFixed(1) : 0,
//             oldestDrawerTask: results.length ? Math.max(...results.map(task => task.daysInDrawer)) : 0
//         };

//         const responseData = {
//             success: true,
//             data: results,
//             summary,
//             generatedAt: new Date(),
//             appliedFilters: req.query
//         };

//         if (format === 'pdf') {
//             return generateAdvancedPDF(res, results, 'דוח משימות מגירה');
//         } else if (format === 'excel') {
//             return generateAdvancedExcel(res, results, 'משימות_מגירה', {
//                 title: 'דוח משימות מגירה',
//                 summary
//             });
//         }

//         res.json(responseData);

//     } catch (error) {
//         console.error('שגיאה בדוח משימות מגירה:', error);
//         res.status(500).json({
//             success: false,
//             message: 'שגיאה ביצירת הדוח',
//             error: error.message
//         });
//     }
// };

// // 5. דוח עמידה ביעדים (חדש)
// export const goalsComplianceReport = async (req, res) => {
//     try {
//         const { employeeId, period = 'month', format = 'json' } = req.query;
        
//         // שליפת יעדים
//         let goalsMatch = { isActive: true };
//         if (employeeId) {
//             goalsMatch.employeeId = employeeId;
//         }
        
//         const goals = await Goal.find(goalsMatch).populate('employeeId', 'userName email');
        
//         const periodStart = moment().subtract(1, period).startOf(period).toDate();
//         const periodEnd = moment().endOf(period).toDate();
        
//         const complianceResults = await Promise.all(goals.map(async (goal) => {
//             const matchStage = {
//                 isDeleted: { $ne: true },
//                 createdAt: { $gte: periodStart, $lte: periodEnd }
//             };
            
//             // התאמה לסוג היעד
//             if (goal.targetType === 'taskType') {
//                 matchStage.importance = goal.taskType;
//             }
            
//             if (goal.employeeId) {
//                 matchStage.$or = [
//                     { mainAssignee: goal.employeeId._id },
//                     { assignees: goal.employeeId._id }
//                 ];
//             }
            
//             const completedTasks = await Task.countDocuments({
//                 ...matchStage,
//                 status: 'הושלם'
//             });
            
//             const totalTasks = await Task.countDocuments(matchStage);
            
//             const compliance = goal.targetValue > 0 ? 
//                 ((completedTasks / goal.targetValue) * 100).toFixed(1) : 0;
                
//             return {
//                 goalId: goal._id,
//                 employeeName: goal.employeeId ? goal.employeeId.userName : 'כללי',
//                 goalDescription: goal.description,
//                 targetValue: goal.targetValue,
//                 actualValue: completedTasks,
//                 compliancePercentage: compliance,
//                 period: goal.period,
//                 taskType: goal.taskType,
//                 status: compliance >= 100 ? 'הושג' : compliance >= 80 ? 'קרוב להשגה' : 'לא הושג'
//             };
//         }));
        
//         const summary = {
//             totalGoals: complianceResults.length,
//             achievedGoals: complianceResults.filter(g => g.status === 'הושג').length,
//             nearAchievement: complianceResults.filter(g => g.status === 'קרוב להשגה').length,
//             notAchieved: complianceResults.filter(g => g.status === 'לא הושג').length,
//             avgCompliance: complianceResults.length ?
//                 (complianceResults.reduce((sum, g) => sum + parseFloat(g.compliancePercentage), 0) / complianceResults.length).toFixed(1) : 0
//         };

//         const responseData = {
//             success: true,
//             data: complianceResults,
//             summary,
//             period: { start: periodStart, end: periodEnd },
//             generatedAt: new Date(),
//             appliedFilters: req.query
//         };

//         if (format === 'pdf') {
//             return generateAdvancedPDF(res, complianceResults, 'דוח עמידה ביעדים');
//         } else if (format === 'excel') {
//             return generateAdvancedExcel(res, complianceResults, 'עמידה_ביעדים', {
//                 title: 'דוח עמידה ביעדים',
//                 summary
//             });
//         }

//         res.json(responseData);

//     } catch (error) {
//         console.error('שגיאה בדוח עמידה ביעדים:', error);
//         res.status(500).json({
//             success: false,
//             message: 'שגיאה ביצירת הדוח',
//             error: error.message
//         });
//     }
// };

// // 6. דוח לפי סיבות אי-ביצוע (חדש)
// export const tasksByFailureReason = async (req, res) => {
//     try {
//         const { format = 'json' } = req.query;
//         const matchStage = buildMatchStage(req.query);
//         matchStage.failureReason = { $exists: true, $ne: null, $ne: '' };

//         const pipeline = [
//             { $match: matchStage },
//             {
//                 $group: {
//                     _id: '$failureReason',
//                     count: { $sum: 1 },
//                     tasks: {
//                         $push: {
//                             taskId: '$taskId',
//                             title: '$title',
//                             status: '$status',
//                             importance: '$importance',
//                             dueDate: '$dueDate'
//                         }
//                     }
//                 }
//             },
//             { $sort: { count: -1 } }
//         ];

//         const results = await Task.aggregate(pipeline);
        
//         // עיבוד התוצאות
//         const processedResults = results.map(item => ({
//             failureReason: item._id,
//             tasksCount: item.count,
//             percentage: results.length ? 
//                 ((item.count / results.reduce((sum, r) => sum + r.count, 0)) * 100).toFixed(1) : 0,
//             tasks: item.tasks
//         }));

//         const responseData = {
//             success: true,
//             data: processedResults,
//             summary: {
//                 totalFailureReasons: results.length,
//                 totalTasksWithFailure: results.reduce((sum, r) => sum + r.count, 0),
//                 topFailureReason: results.length ? results[0]._id : null
//             },
//             generatedAt: new Date(),
//             appliedFilters: req.query
//         };

//         if (format === 'pdf') {
//             return generateAdvancedPDF(res, processedResults, 'דוח לפי סיבות אי-ביצוע');
//         } else if (format === 'excel') {
//             return generateAdvancedExcel(res, processedResults, 'סיבות_אי_ביצוע', {
//                 title: 'דוח לפי סיבות אי-ביצוע'
//             });
//         }

//         res.json(responseData);

//     } catch (error) {
//         console.error('שגיאה בדוח סיבות אי-ביצוע:', error);
//         res.status(500).json({
//             success: false,
//             message: 'שגיאה ביצירת הדוח',
//             error: error.message
//         });
//     }
// };

// 7. דוח משימות קבועות (חדש)
// export const recurringTasksReport = async (req, res) => {
//     try {
//         const { format = 'json' } = req.query;
        
//         // שליפת משימות קבועות מטבלת RecurringTasks
//         const recurringTasks = await RecurringTask.find({ isActive: true })
//             .populate('mainAssignee', 'userName')
//             .populate('organization', 'name');
        
//         // שליפת מופעי המשימות הקבועות שכבר נוצרו
//         const instancesPromises = recurringTasks.map(async (recurring) => {
//             const instances = await Task.find({
//                 isRecurringInstance: true,
//                 parentRecurringId: recurring._id
//             });
            
//             const completed = instances.filter(i => i.status ===