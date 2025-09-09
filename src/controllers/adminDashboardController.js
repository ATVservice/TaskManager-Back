import Task from '../models/Task.js';
import Goal from '../models/Goal.js';
import User from '../models/User.js';
import dayjs from 'dayjs';

// פונקציה עזר לחישוב טווחי זמן
const getTimeRange = (filterType, customStart, customEnd) => {
    const now = dayjs();
    
    switch (filterType) {
        case 'day':
            return {
                from: now.startOf('day').toDate(),
                to: now.endOf('day').toDate()
            };
        case 'week':
            return {
                from: now.startOf('week').toDate(),
                to: now.endOf('week').toDate()
            };
        case 'year':
            return {
                from: now.startOf('year').toDate(),
                to: now.endOf('year').toDate()
            };
        case 'custom':
            return {
                from: new Date(customStart),
                to: new Date(customEnd)
            };
        default: // 'month' or undefined - ברירת מחדל
            return {
                from: now.startOf('month').toDate(),
                to: now.endOf('month').toDate()
            };
    }
};

export const getGeneralSummary = async (req, res) => {
    try {
        // 🔹 שינוי 1: קבלת פרמטר filterType נוסף
        const { filterType = 'month', startDate, endDate } = req.query;
        
        // 🔹 שינוי 2: טווח זמן לפילוח לפי חשיבות (לפי הסינון שנבחר)
        const importanceRange = getTimeRange(filterType, startDate, endDate);
        
        // 🔹 שינוי 3: טווח זמן קבוע להשוואת משימות (תמיד חודש נוכחי מול קודם)
        const comparisonCurrent = {
            from: dayjs().startOf('month').toDate(),
            to: dayjs().endOf('month').toDate()
        };
        const comparisonPrevious = {
            from: dayjs().subtract(1, 'month').startOf('month').toDate(),
            to: dayjs().subtract(1, 'month').endOf('month').toDate()
        };

        // 🔹 שינוי 4: עדכון האגרגציה
        const tasksAgg = await Task.aggregate([
            { $match: { isDeleted: false, status: 'הושלם' } },
            {
                $facet: {
                    // פילוח לפי חשיבות - לפי הסינון שנבחר
                    importanceBreakdown: [
                        { $match: { updatedAt: { $gte: importanceRange.from, $lte: importanceRange.to } } },
                        { $group: { _id: '$importance', count: { $sum: 1 } } }
                    ],
                    // השוואת משימות - חודש נוכחי
                    currentMonthComparison: [
                        { $match: { updatedAt: { $gte: comparisonCurrent.from, $lte: comparisonCurrent.to } } },
                        { $count: 'count' }
                    ],
                    // השוואת משימות - חודש קודם
                    prevMonthComparison: [
                        { $match: { updatedAt: { $gte: comparisonPrevious.from, $lte: comparisonPrevious.to } } },
                        { $count: 'count' }
                    ],
                    // נתונים לביצועי עובדים - כל הזמנים (בלי הגבלת זמן)
                    employeePerformance: [
                        { $unwind: '$assignees' },
                        { $group: { _id: { assignee: '$assignees', importance: '$importance' }, count: { $sum: 1 } } }
                    ],
                    totalFiltered: [
                        { $match: { updatedAt: { $gte: importanceRange.from, $lte: importanceRange.to } } },
                        { $count: 'count' }
                    ],
                }
            }
        ]);

        // 🔹 שינוי 5: עדכון המשתנים
        const byImportance = tasksAgg[0].importanceBreakdown;
        const currentMonthCompleted = tasksAgg[0].currentMonthComparison[0]?.count || 0;
        const prevMonthCompleted = tasksAgg[0].prevMonthComparison[0]?.count || 0;
        const totalCompletedFiltered = tasksAgg[0].totalFiltered[0]?.count || 0; // הוסיפי את השורה הזאת


        // Map<employeeId, Map<importance, count>> - לביצועי עובדים (כל הנתונים)
        const byAssigneeMap = new Map();
        tasksAgg[0].employeePerformance.forEach(item => {
            const empId = item._id.assignee.toString();
            const imp = item._id.importance;
            if (!byAssigneeMap.has(empId)) byAssigneeMap.set(empId, new Map());
            byAssigneeMap.get(empId).set(imp, item.count);
        });

        // 🔹 יעדים כלליים - מבוסס על הפילוח לפי חשיבות
        const generalGoals = await Goal.find({ targetType: 'כלל העובדים' });
        const goalsSummary = generalGoals.map(goal => {
            const count = byImportance.find(t => t._id === goal.importance)?.count || 0;
            const percent = (count / goal.targetCount) * 100;
            return {
                goalId: goal._id,
                importance: goal.importance,
                targetCount: goal.targetCount,
                completedCount: count,
                percent: Math.round(percent),
                status:
                    percent > 100 ? 'מעבר לציפיות' :
                    percent === 100 ? 'עומד ביעד' :
                    'פיגור'
            };
        });
        const overallGoalAchievement =
            goalsSummary.length > 0
                ? Math.round(goalsSummary.reduce((acc, g) => acc + g.percent, 0) / goalsSummary.length)
                : 0;

        // 🔹 דירוג עובדים - מבוסס על כל הנתונים (ללא הגבלת זמן)
        const employees = await User.find({ role: 'עובד' });
        const personalGoals = await Goal.find({ targetType: 'עובד בודד' });
        const generalGoalsByEmployee = generalGoals;

        const employeeRatings = employees.map(emp => {
            const empId = emp._id.toString();
            const empGoals = [
                ...personalGoals.filter(g => g.employee?.toString() === empId),
                ...generalGoalsByEmployee
            ];

            if (empGoals.length === 0) {
                return {
                    employeeId: emp._id,
                    employeeUserName: emp.userName,
                    employeeName: `${emp.firstName} ${emp.lastName}`,
                    percent: null,
                    rating: 'אין יעדים מוגדרים'
                };
            }

            let done = 0;
            let required = 0;

            empGoals.forEach(goal => {
                const count = byAssigneeMap.get(empId)?.get(goal.importance) || 0;
                done += count;
                required += goal.targetCount;
            });

            const percent = required > 0 ? (done / required) * 100 : 0;
            let rating = 'פיגור';
            if (percent === 100) rating = 'עומד ביעד';
            if (percent > 100) rating = 'מעבר לציפיות';

            return {
                employeeId: emp._id,
                employeeUserName: emp.userName,
                employeeName: `${emp.firstName} ${emp.lastName}`,
                percent: Math.round(percent),
                rating
            };
        });

        const overallPersonalGoals =
            employeeRatings.length > 0
                ? Math.round(
                    employeeRatings
                        .filter(e => e.percent !== null)
                        .reduce((acc, e) => acc + e.percent, 0) /
                    employeeRatings.filter(e => e.percent !== null).length
                )
                : 0;

        // 🔹 שינוי 6: השוואה מעודכנת
        const comparison = {
            current: currentMonthCompleted,
            previous: prevMonthCompleted,
            changePercent: prevMonthCompleted > 0 ? ((currentMonthCompleted - prevMonthCompleted) / prevMonthCompleted) * 100 : 100
        };

        // 🔹 שינוי 7: החזרת נתונים עם מידע נוסף על הסינון
        res.json({
            // מידע על הסינון שבוצע
            filterInfo: {
                type: filterType,
                dateRange: {
                    from: importanceRange.from,
                    to: importanceRange.to
                }
            },
            // סך כל משימות שהושלמו לפי הסינון
            totalCompletedFiltered,
            // פילוח לפי חשיבות (לפי הסינון שנבחר)
            tasksByImportance: byImportance,
            // יעדים כלליים (מבוסס על הפילוח)
            goalsSummary,
            overallGeneralGoals: overallGoalAchievement,
            // השוואת משימות (תמיד חודש נוכחי מול קודם)
            comparison,
            // ביצועי עובדים (כל הנתונים)
            overallPersonalGoals,
            employeeRatings
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'שגיאה בשליפת סיכום כללי' });
    }
};

// import Task from '../models/Task.js';
// import RecurringTask from '../models/RecurringTask.js';
// import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
// import Goal from '../models/Goal.js';
// import User from '../models/User.js';
// import dayjs from 'dayjs';

// // פונקציה עזר לחישוב טווחי זמן
// const getTimeRange = (filterType, customStart, customEnd) => {
//     const now = dayjs();
    
//     switch (filterType) {
//         case 'day':
//             return {
//                 from: now.startOf('day').toDate(),
//                 to: now.endOf('day').toDate()
//             };
//         case 'week':
//             return {
//                 from: now.startOf('week').toDate(),
//                 to: now.endOf('week').toDate()
//             };
//         case 'year':
//             return {
//                 from: now.startOf('year').toDate(),
//                 to: now.endOf('year').toDate()
//             };
//         case 'custom':
//             return {
//                 from: new Date(customStart),
//                 to: new Date(customEnd)
//             };
//         default: // 'month' or undefined - ברירת מחדל
//             return {
//                 from: now.startOf('month').toDate(),
//                 to: now.endOf('month').toDate()
//             };
//     }
// };

// // פונקציה עזר לאיסוף כל המשימות המושלמות מכל המקורות
// const getAllCompletedTasks = async (timeRange) => {
//     const tasks = [];
    
//     // 1. משימות רגילות מהטבלה הראשית (Task)
//     const regularTasks = await Task.find({
//         isDeleted: false,
//         status: 'הושלם',
//         updatedAt: { $gte: timeRange.from, $lte: timeRange.to }
//     }).populate('assignees');
    
//     regularTasks.forEach(task => {
//         task.assignees.forEach(assignee => {
//             tasks.push({
//                 importance: task.importance,
//                 assignee: assignee._id,
//                 completedDate: task.updatedAt,
//                 source: 'Task'
//             });
//         });
//     });
    
//     // 2. משימות מ-TaskAssigneeDetails
//     const taskAssigneeDetails = await TaskAssigneeDetails.find({
//         status: 'הושלם',
//         updatedAt: { $gte: timeRange.from, $lte: timeRange.to }
//     }).populate([
//         { path: 'taskId', refPath: 'taskModel' },
//         { path: 'user' }
//     ]);
    
//     taskAssigneeDetails.forEach(detail => {
//         if (detail.taskId && !detail.taskId.isDeleted) {
//             tasks.push({
//                 importance: detail.taskId.importance,
//                 assignee: detail.user._id,
//                 completedDate: detail.updatedAt,
//                 source: 'TaskAssigneeDetails'
//             });
//         }
//     });
    
//     // 3. משימות קבועות מ-notes
//     const recurringTasks = await RecurringTask.find({
//         isDeleted: false,
//         'notes.date': { $gte: timeRange.from, $lte: timeRange.to },
//         'notes.status': 'הושלם'
//     }).populate('assignees');
    
//     recurringTasks.forEach(task => {
//         const completedNotes = task.notes.filter(note => 
//             note.status === 'הושלם' &&
//             note.date >= timeRange.from &&
//             note.date <= timeRange.to
//         );
        
//         completedNotes.forEach(note => {
//             task.assignees.forEach(assignee => {
//                 tasks.push({
//                     importance: task.importance,
//                     assignee: assignee,
//                     completedDate: note.date,
//                     source: 'RecurringTask'
//                 });
//             });
//         });
//     });
    
//     return tasks;
// };

// // פונקציה עזר לאיסוף כל המשימות המושלמות בלי הגבלת זמן (לביצועי עובדים)
// const getAllCompletedTasksUnlimited = async () => {
//     const tasks = [];
    
//     // 1. משימות רגילות
//     const regularTasks = await Task.find({
//         isDeleted: false,
//         status: 'הושלם'
//     }).populate('assignees');
    
//     regularTasks.forEach(task => {
//         task.assignees.forEach(assignee => {
//             tasks.push({
//                 importance: task.importance,
//                 assignee: assignee._id,
//                 completedDate: task.updatedAt
//             });
//         });
//     });
    
//     // 2. משימות מ-TaskAssigneeDetails
//     const taskAssigneeDetails = await TaskAssigneeDetails.find({
//         status: 'הושלם'
//     }).populate([
//         { path: 'taskId', refPath: 'taskModel' },
//         { path: 'user' }
//     ]);
    
//     taskAssigneeDetails.forEach(detail => {
//         if (detail.taskId && !detail.taskId.isDeleted) {
//             tasks.push({
//                 importance: detail.taskId.importance,
//                 assignee: detail.user._id,
//                 completedDate: detail.updatedAt
//             });
//         }
//     });
    
//     // 3. משימות קבועות מ-notes
//     const recurringTasks = await RecurringTask.find({
//         isDeleted: false,
//         'notes.status': 'הושלם'
//     }).populate('assignees');
    
//     recurringTasks.forEach(task => {
//         const completedNotes = task.notes.filter(note => note.status === 'הושלם');
        
//         completedNotes.forEach(note => {
//             task.assignees.forEach(assignee => {
//                 tasks.push({
//                     importance: task.importance,
//                     assignee: assignee,
//                     completedDate: note.date
//                 });
//             });
//         });
//     });
    
//     return tasks;
// };

// export const getGeneralSummary = async (req, res) => {
//     try {
//         const { filterType = 'month', startDate, endDate } = req.query;
        
//         // טווח זמן לפילוח לפי חשיבות (לפי הסינון שנבחר)
//         const importanceRange = getTimeRange(filterType, startDate, endDate);
        
//         // טווח זמן קבוע להשוואת משימות (תמיד חודש נוכחי מול קודם)
//         const comparisonCurrent = {
//             from: dayjs().startOf('month').toDate(),
//             to: dayjs().endOf('month').toDate()
//         };
//         const comparisonPrevious = {
//             from: dayjs().subtract(1, 'month').startOf('month').toDate(),
//             to: dayjs().subtract(1, 'month').endOf('month').toDate()
//         };

//         // איסוף נתונים מכל המקורות
//         const filteredTasks = await getAllCompletedTasks(importanceRange);
//         const currentMonthTasks = await getAllCompletedTasks(comparisonCurrent);
//         const prevMonthTasks = await getAllCompletedTasks(comparisonPrevious);
//         const allTasksUnlimited = await getAllCompletedTasksUnlimited();

//         // פילוח לפי חשיבות
//         const importanceBreakdown = {};
//         filteredTasks.forEach(task => {
//             importanceBreakdown[task.importance] = (importanceBreakdown[task.importance] || 0) + 1;
//         });

//         const byImportance = Object.entries(importanceBreakdown).map(([importance, count]) => ({
//             _id: importance,
//             count
//         }));

//         // השוואת משימות
//         const currentMonthCompleted = currentMonthTasks.length;
//         const prevMonthCompleted = prevMonthTasks.length;

//         // ביצועי עובדים - Map<employeeId, Map<importance, count>>
//         const byAssigneeMap = new Map();
//         allTasksUnlimited.forEach(task => {
//             const empId = task.assignee.toString();
//             const imp = task.importance;
//             if (!byAssigneeMap.has(empId)) byAssigneeMap.set(empId, new Map());
//             const currentCount = byAssigneeMap.get(empId).get(imp) || 0;
//             byAssigneeMap.get(empId).set(imp, currentCount + 1);
//         });

//         // יעדים כלליים - מבוסס על הפילוח לפי חשיבות
//         const generalGoals = await Goal.find({ targetType: 'כלל העובדים' });
//         const goalsSummary = generalGoals.map(goal => {
//             const count = byImportance.find(t => t._id === goal.importance)?.count || 0;
//             const percent = goal.targetCount > 0 ? (count / goal.targetCount) * 100 : 0;
//             return {
//                 goalId: goal._id,
//                 importance: goal.importance,
//                 targetCount: goal.targetCount,
//                 completedCount: count,
//                 percent: Math.round(percent),
//                 status:
//                     percent > 100 ? 'מעבר לציפיות' :
//                     percent === 100 ? 'עומד ביעד' :
//                     'פיגור'
//             };
//         });

//         const overallGoalAchievement =
//             goalsSummary.length > 0
//                 ? Math.round(goalsSummary.reduce((acc, g) => acc + g.percent, 0) / goalsSummary.length)
//                 : 0;

//         // דירוג עובדים - מבוסס על כל הנתונים (ללא הגבלת זמן)
//         const employees = await User.find({ role: 'עובד' });
//         const personalGoals = await Goal.find({ targetType: 'עובד בודד' });
//         const generalGoalsByEmployee = generalGoals;

//         const employeeRatings = employees.map(emp => {
//             const empId = emp._id.toString();
//             const empGoals = [
//                 ...personalGoals.filter(g => g.employee?.toString() === empId),
//                 ...generalGoalsByEmployee
//             ];

//             if (empGoals.length === 0) {
//                 return {
//                     employeeId: emp._id,
//                     employeeUserName: emp.userName,
//                     employeeName: `${emp.firstName} ${emp.lastName}`,
//                     percent: null,
//                     rating: 'אין יעדים מוגדרים'
//                 };
//             }

//             let done = 0;
//             let required = 0;

//             empGoals.forEach(goal => {
//                 const count = byAssigneeMap.get(empId)?.get(goal.importance) || 0;
//                 done += count;
//                 required += goal.targetCount;
//             });

//             const percent = required > 0 ? (done / required) * 100 : 0;
//             let rating = 'פיגור';
//             if (percent === 100) rating = 'עומד ביעד';
//             if (percent > 100) rating = 'מעבר לציפיות';

//             return {
//                 employeeId: emp._id,
//                 employeeUserName: emp.userName,
//                 employeeName: `${emp.firstName} ${emp.lastName}`,
//                 percent: Math.round(percent),
//                 rating
//             };
//         });

//         const overallPersonalGoals =
//             employeeRatings.length > 0
//                 ? Math.round(
//                     employeeRatings
//                         .filter(e => e.percent !== null)
//                         .reduce((acc, e) => acc + e.percent, 0) /
//                     employeeRatings.filter(e => e.percent !== null).length
//                 )
//                 : 0;

//         // השוואה מעודכנת
//         const comparison = {
//             current: currentMonthCompleted,
//             previous: prevMonthCompleted,
//             changePercent: prevMonthCompleted > 0 ? ((currentMonthCompleted - prevMonthCompleted) / prevMonthCompleted) * 100 : 100
//         };

//         // החזרת נתונים עם מידע נוסף על הסינון
//         res.json({
//             // מידע על הסינון שבוצע
//             filterInfo: {
//                 type: filterType,
//                 dateRange: {
//                     from: importanceRange.from,
//                     to: importanceRange.to
//                 }
//             },
//             // סך כל משימות שהושלמו לפי הסינון
//             totalCompletedFiltered: filteredTasks.length,
//             // פילוח לפי חשיבות (לפי הסינון שנבחר)
//             tasksByImportance: byImportance,
//             // יעדים כלליים (מבוסס על הפילוח)
//             goalsSummary,
//             overallGeneralGoals: overallGoalAchievement,
//             // השוואת משימות (תמיד חודש נוכחי מול קודם)
//             comparison,
//             // ביצועי עובדים (כל הנתונים)
//             overallPersonalGoals,
//             employeeRatings,
//             // מידע על מקורות הנתונים (לדיבוג)
//             debugInfo: {
//                 regularTasksCount: filteredTasks.filter(t => t.source === 'Task').length,
//                 assigneeDetailsCount: filteredTasks.filter(t => t.source === 'TaskAssigneeDetails').length,
//                 recurringTasksCount: filteredTasks.filter(t => t.source === 'RecurringTask').length
//             }
//         });

//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ message: 'שגיאה בשליפת סיכום כללי' });
//     }
// };