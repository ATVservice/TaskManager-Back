import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import Goal from '../models/Goal.js';
import User from '../models/User.js';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const ISRAEL_TIMEZONE = "Asia/Jerusalem";

// Cache עם TTL
const cache = new Map();
const CACHE_TTL = 3 * 60 * 1000; // 3 דקות

const getCached = (key) => {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    cache.delete(key);
    return null;
};

const setCache = (key, data) => {
    cache.set(key, { data, timestamp: Date.now() });
};

// ניקוי cache
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
            cache.delete(key);
        }
    }
}, CACHE_TTL);

const getIsraeliDate = (date) => dayjs(date).tz(ISRAEL_TIMEZONE);
const getStartOfDay = (date) => getIsraeliDate(date).startOf('day');

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
        default: 
            return {
                from: now.startOf('month').toDate(),
                to: now.endOf('month').toDate()
            };
    }
};

const isRecurringTaskCompletedForManager = (task, targetDate) => {
    try {
        if (!task.notes?.length) return false;

        const targetDay = getStartOfDay(targetDate);
        
        const dayNotes = task.notes.filter(note => {
            if (!note.date) return false;
            const noteDate = getStartOfDay(note.date);
            return noteDate.isSame(targetDay, 'day');
        });

        if (!dayNotes.length) return false;

        if (dayNotes.some(n => n.status === 'הושלם' && n.user?.role === 'מנהל')) {
            return true;
        }

        const lastStatus = new Map();
        dayNotes
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .forEach(note => {
                if (note.user) {
                    const uid = (typeof note.user === 'object' ? note.user._id : note.user).toString();
                    lastStatus.set(uid, note.status);
                }
            });

        const completed = new Set();
        lastStatus.forEach((status, uid) => {
            if (status === 'הושלם') completed.add(uid);
        });

        if (completed.size === 0) return false;

        const mainId = task.mainAssignee?._id?.toString();
        if (mainId && completed.has(mainId)) return true;

        const secondaryIds = task.assignees
            ?.map(a => a._id.toString())
            .filter(id => id !== mainId) || [];
        
        return secondaryIds.length > 0 && secondaryIds.every(id => completed.has(id));

    } catch (error) {
        console.error(`Error checking recurring task completion: ${task._id}:`, error.message);
        return false;
    }
};

const createDateRange = (startDate, endDate) => {
    const dates = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    
    current.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    
    // מגבלת בטיחות
    const maxDays = 400;
    let count = 0;
    
    while (current <= end && count < maxDays) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
        count++;
    }
    
    return dates;
};

// שליפה חכמה אחת לכל הטווחים
const getAllRecurringTasksData = async (importanceRange, currentMonth, prevMonth) => {
    const cacheKey = `recurring_all_${importanceRange.from.getTime()}_${importanceRange.to.getTime()}`;
    const cached = getCached(cacheKey);
    if (cached) {
        console.log('✅ Recurring cache hit');
        return cached;
    }

    console.log('📊 Fetching all recurring tasks...');
    
    // שליפה אחת של כל המשימות הקבועות (ללא הגבלת תאריך!)
    const allRecurring = await RecurringTask.find({
        isDeleted: { $ne: true }
    })
    .populate('notes.user', 'firstName lastName userName role')
    .populate('mainAssignee', '_id firstName lastName')
    .populate('assignees', '_id firstName lastName')
    .select('_id importance notes mainAssignee assignees')
    .lean();

    console.log(`📋 Found ${allRecurring.length} recurring tasks`);

    // עיבוד חכם - פעם אחת לכל הטווחים
    const result = {
        importanceRange: [],
        currentMonth: [],
        prevMonth: [],
        allTimeByEmployee: []
    };

    // יצירת טווחי תאריכים
    const ranges = {
        importance: createDateRange(importanceRange.from, importanceRange.to),
        current: createDateRange(currentMonth.from, currentMonth.to),
        prev: createDateRange(prevMonth.from, prevMonth.to)
    };

    console.log(`📅 Date ranges - importance: ${ranges.importance.length}, current: ${ranges.current.length}, prev: ${ranges.prev.length}`);

    // עיבוד כל משימה פעם אחת
    for (const task of allRecurring) {
        // איסוף כל התאריכים שהמשימה הושלמה בהם
        const completedDates = new Set();
        
        // בדיקה לכל טווח
        for (const date of ranges.importance) {
            if (isRecurringTaskCompletedForManager(task, date)) {
                completedDates.add(date.getTime());
                result.importanceRange.push({
                    importance: task.importance,
                    date
                });
            }
        }

        for (const date of ranges.current) {
            if (completedDates.has(date.getTime()) || isRecurringTaskCompletedForManager(task, date)) {
                result.currentMonth.push({ importance: task.importance });
            }
        }

        for (const date of ranges.prev) {
            if (completedDates.has(date.getTime()) || isRecurringTaskCompletedForManager(task, date)) {
                result.prevMonth.push({ importance: task.importance });
            }
        }

        // לביצועי עובדים - כל ההיסטוריה (כמו הגרסה המקורית!)
        if (task.notes && task.notes.length > 0) {
            // כל note שמסומן כהושלם
            const allCompletedNotes = task.notes.filter(note => 
                note.status === 'הושלם'
            );

            allCompletedNotes.forEach(note => {
                const users = new Set();
                
                if (task.mainAssignee?._id) {
                    users.add(task.mainAssignee._id.toString());
                }
                
                if (task.assignees) {
                    task.assignees.forEach(a => {
                        if (a._id) users.add(a._id.toString());
                    });
                }

                users.forEach(userId => {
                    result.allTimeByEmployee.push({
                        assignee: userId,
                        importance: task.importance
                    });
                });
            });
        }
    }

    console.log(`✅ Processed - importance: ${result.importanceRange.length}, current: ${result.currentMonth.length}, prev: ${result.prevMonth.length}, employee: ${result.allTimeByEmployee.length}`);

    setCache(cacheKey, result);
    return result;
};

export const getGeneralSummary = async (req, res) => {
    try {
        const startTime = Date.now();
        const { filterType = 'month', startDate, endDate } = req.query;
        
        // בדיקת cache כללי
        const cacheKey = `summary_${filterType}_${startDate}_${endDate}`;
        const cached = getCached(cacheKey);
        if (cached) {
            console.log(`✅ Full cache hit - ${Date.now() - startTime}ms`);
            return res.json(cached);
        }

        const importanceRange = getTimeRange(filterType, startDate, endDate);
        
        const comparisonCurrent = {
            from: dayjs().startOf('month').toDate(),
            to: dayjs().endOf('month').toDate()
        };
        const comparisonPrevious = {
            from: dayjs().subtract(1, 'month').startOf('month').toDate(),
            to: dayjs().subtract(1, 'month').endOf('month').toDate()
        };

        console.log('⏱️ Starting data fetch...');

        // שליפה חכמה אחת של recurring
        const recurringData = await getAllRecurringTasksData(
            importanceRange,
            comparisonCurrent,
            comparisonPrevious
        );

        console.log(`⏱️ Recurring done: ${Date.now() - startTime}ms`);

        // אגרגציה של Task (ללא שינוי - כמו המקורי!)
        const tasksAgg = await Task.aggregate([
            { $match: { isDeleted: false } },
            {
                $lookup: {
                    from: 'taskassigneedetails',
                    localField: '_id',
                    foreignField: 'taskId',
                    as: 'assigneeDetails'
                }
            },
            {
                $addFields: {
                    isCompleted: {
                        $or: [
                            { $eq: ['$status', 'הושלם'] },
                            {
                                $gt: [
                                    {
                                        $size: {
                                            $filter: {
                                                input: '$assigneeDetails',
                                                cond: { $eq: ['$$this.status', 'הושלם'] }
                                            }
                                        }
                                    },
                                    0
                                ]
                            }
                        ]
                    }
                }
            },
            { $match: { isCompleted: true } },
            {
                $facet: {
                    importanceBreakdown: [
                        { $match: { updatedAt: { $gte: importanceRange.from, $lte: importanceRange.to } } },
                        { $group: { _id: '$importance', count: { $sum: 1 } } }
                    ],
                    currentMonthComparison: [
                        { $match: { updatedAt: { $gte: comparisonCurrent.from, $lte: comparisonCurrent.to } } },
                        { $count: 'count' }
                    ],
                    prevMonthComparison: [
                        { $match: { updatedAt: { $gte: comparisonPrevious.from, $lte: comparisonPrevious.to } } },
                        { $count: 'count' }
                    ],
                    employeePerformance: [
                        {
                            $addFields: {
                                completedAssignees: {
                                    $cond: {
                                        if: { $eq: ['$status', 'הושלם'] },
                                        then: '$assignees',
                                        else: {
                                            $map: {
                                                input: {
                                                    $filter: {
                                                        input: '$assigneeDetails',
                                                        cond: { $eq: ['$$this.status', 'הושלם'] }
                                                    }
                                                },
                                                as: 'detail',
                                                in: '$$detail.user'
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        { $unwind: '$completedAssignees' },
                        { $group: { _id: { assignee: '$completedAssignees', importance: '$importance' }, count: { $sum: 1 } } }
                    ],
                    totalFiltered: [
                        { $match: { updatedAt: { $gte: importanceRange.from, $lte: importanceRange.to } } },
                        { $count: 'count' }
                    ],
                }
            }
        ]);

        console.log(`⏱️ Task aggregation done: ${Date.now() - startTime}ms`);

        // שילוב נתונים - זהה למקורי!
        const regularByImportance = tasksAgg[0].importanceBreakdown;
        const recurringByImportance = recurringData.importanceRange.reduce((acc, item) => {
            const existing = acc.find(x => x._id === item.importance);
            if (existing) {
                existing.count += 1;
            } else {
                acc.push({ _id: item.importance, count: 1 });
            }
            return acc;
        }, []);

        const byImportance = [...regularByImportance];
        recurringByImportance.forEach(item => {
            const existing = byImportance.find(x => x._id === item._id);
            if (existing) {
                existing.count += item.count;
            } else {
                byImportance.push(item);
            }
        });

        const regularCurrentMonth = tasksAgg[0].currentMonthComparison[0]?.count || 0;
        const regularPrevMonth = tasksAgg[0].prevMonthComparison[0]?.count || 0;
        
        const currentMonthCompleted = regularCurrentMonth + recurringData.currentMonth.length;
        const prevMonthCompleted = regularPrevMonth + recurringData.prevMonth.length;
        
        const regularTotalFiltered = tasksAgg[0].totalFiltered[0]?.count || 0;
        const totalCompletedFiltered = regularTotalFiltered + recurringData.importanceRange.length;

        // ביצועי עובדים - כל ההיסטוריה (כמו המקורי!)
        const byAssigneeMap = new Map();
        
        tasksAgg[0].employeePerformance.forEach(item => {
            const empId = item._id.assignee.toString();
            const imp = item._id.importance;
            if (!byAssigneeMap.has(empId)) byAssigneeMap.set(empId, new Map());
            byAssigneeMap.get(empId).set(imp, item.count);
        });

        // מיזוג עם recurring - כל ההיסטוריה!
        recurringData.allTimeByEmployee.forEach(completion => {
            const empId = completion.assignee.toString();
            const imp = completion.importance;
            if (!byAssigneeMap.has(empId)) byAssigneeMap.set(empId, new Map());
            const current = byAssigneeMap.get(empId).get(imp) || 0;
            byAssigneeMap.get(empId).set(imp, current + 1);
        });

        console.log(`⏱️ Employee data merged: ${Date.now() - startTime}ms`);

        // יעדים ודירוגים - זהה למקורי!
        const [generalGoals, employees, personalGoals] = await Promise.all([
            Goal.find({ targetType: 'כלל העובדים' }).lean(),
            User.find().select('_id userName firstName lastName').lean(),
            Goal.find({ targetType: 'עובד בודד' }).lean()
        ]);

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

        const employeeRatings = employees.map(emp => {
            const empId = emp._id.toString();
            const empGoals = [
                ...personalGoals.filter(g => g.employee?.toString() === empId),
                ...generalGoals
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

        const comparison = {
            current: currentMonthCompleted,
            previous: prevMonthCompleted,
            changePercent: prevMonthCompleted > 0 
                ? Math.round(((currentMonthCompleted - prevMonthCompleted) / prevMonthCompleted) * 100)
                : 100
        };

        const response = {
            filterInfo: {
                type: filterType,
                dateRange: {
                    from: importanceRange.from,
                    to: importanceRange.to
                }
            },
            totalCompletedFiltered,
            tasksByImportance: byImportance,
            goalsSummary,
            overallGeneralGoals: overallGoalAchievement,
            comparison,
            overallPersonalGoals,
            employeeRatings,
            meta: {
                processingTimeMs: Date.now() - startTime,
                cached: false,
                recurringTasksProcessed: recurringData.importanceRange.length,
                regularTasksProcessed: regularTotalFiltered
            }
        };

        setCache(cacheKey, response);
        console.log(`✅ Total processing time: ${Date.now() - startTime}ms`);

        res.json(response);

    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ message: 'שגיאה בשליפת סיכום כללי', error: error.message });
    }
};