import Task from '../models/Task.js';
import Goal from '../models/Goal.js';
import User from '../models/User.js';
import dayjs from 'dayjs';



export const getGeneralSummary = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const from = startDate ? new Date(startDate) : dayjs().startOf('month').toDate();
        const to = endDate ? new Date(endDate) : dayjs().endOf('month').toDate();

        const prevFrom = dayjs(from).subtract(1, 'month').toDate();
        const prevTo = dayjs(to).subtract(1, 'month').toDate();

        // 🔹 Aggregation אחד על כל משימות החודש הנוכחי והחודש הקודם
        const tasksAgg = await Task.aggregate([
            { $match: { isDeleted: false, status: 'הושלם' } },
            {
                $facet: {
                    currentMonth: [
                        { $match: { updatedAt: { $gte: from, $lte: to } } },
                        { $group: { _id: '$importance', count: { $sum: 1 } } }
                    ],
                    prevMonth: [
                        { $match: { updatedAt: { $gte: prevFrom, $lte: prevTo } } },
                        { $count: 'count' }
                    ],
                    byAssignee: [
                        { $match: { updatedAt: { $gte: from, $lte: to } } },
                        { $unwind: '$assignees' },
                        { $group: { _id: { assignee: '$assignees', importance: '$importance' }, count: { $sum: 1 } } }
                    ],
                    totalCurrent: [
                        { $match: { updatedAt: { $gte: from, $lte: to } } },
                        { $count: 'count' }
                    ]
                }
            }
        ]);

        const byImportance = tasksAgg[0].currentMonth;
        const prevCompleted = tasksAgg[0].prevMonth[0]?.count || 0;
        const totalCompleted = tasksAgg[0].totalCurrent[0]?.count || 0;

        // Map<employeeId, Map<importance, count>>
        const byAssigneeMap = new Map();
        tasksAgg[0].byAssignee.forEach(item => {
            const empId = item._id.assignee.toString();
            const imp = item._id.importance;
            if (!byAssigneeMap.has(empId)) byAssigneeMap.set(empId, new Map());
            byAssigneeMap.get(empId).set(imp, item.count);
        });

        // 🔹 יעדים כלליים
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

        // 🔹 דירוג עובדים (כמו קודם אך תוך שימוש ב-Map)
        const employees = await User.find({ role: 'עובד' });
        const personalGoals = await Goal.find({ targetType: 'עובד בודד' });
        const generalGoalsByEmployee = generalGoals; // כל העובדים מקבלים גם את הכלליים

        const employeeRatings = employees.map(emp => {
            const empId = emp._id.toString();
            const empGoals = [
                ...personalGoals.filter(g => g.employee?.toString() === empId),
                ...generalGoalsByEmployee
            ];

            if (empGoals.length === 0) {
                return {
                    employeeId:emp._id,
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
                employeeId:emp._id,
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
            current: totalCompleted,
            previous: prevCompleted,
            changePercent: prevCompleted > 0 ? ((totalCompleted - prevCompleted) / prevCompleted) * 100 : 100
        };

        res.json({
            totalCompleted,
            tasksByImportance: byImportance,
            goalsSummary,
            overallGeneralGoals: overallGoalAchievement,
            overallPersonalGoals,
            employeeRatings,
            comparison
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'שגיאה בשליפת סיכום כללי' });
    }
};
