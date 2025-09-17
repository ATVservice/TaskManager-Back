import Task from '../models/Task.js';
import TodayTask from '../models/TodayTask.js';
import RecurringTask from '../models/RecurringTask.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import mongoose from 'mongoose';
import dayjs from 'dayjs';
import Goal from '../models/Goal.js';

// פונקציות עזר לטיפול בזמן ישראל
const toIsraeliTime = (date) => {
    return new Date(new Date(date).toLocaleString("en-US", {timeZone: "Asia/Jerusalem"}));
};

const getStartOfDay = (date) => {
    const israeliDate = toIsraeliTime(date);
    israeliDate.setHours(0, 0, 0, 0);
    return israeliDate;
};

const getEndOfDay = (date) => {
    const israeliDate = toIsraeliTime(date);
    israeliDate.setHours(23, 59, 59, 999);
    return israeliDate;
};

// פונקציה לקבלת העדכון האחרון ביום מ-notes של משימה קבועה
const getLastDailyUpdateFromNotes = (notes, targetDate) => {
    const startOfDay = getStartOfDay(targetDate);
    const endOfDay = getEndOfDay(targetDate);
    
    const dailyNotes = notes.filter(note => {
        const noteDate = new Date(note.date);
        return noteDate >= startOfDay && noteDate <= endOfDay;
    });
    
    // מיון לפי תאריך יורד ולקיחת הראשון (האחרון ביום)
    return dailyNotes.sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
};

// יצירת מערך ימים בטווח התאריכים
const createDateRange = (startDate, endDate) => {
    const dates = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    
    current.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    
    while (current <= end) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
    }
    
    return dates;
};

const fetchTasksForUserRange = async (Model, targetId, startDate, endDate) => {
    const tasks = await Model.find({
        assignees: targetId,
        updatedAt: { $gte: startDate, $lte: endDate },
        isDeleted: { $ne: true }
    }).lean();

    const taskIds = tasks.map(t => t._id);
    const personalStatuses = await TaskAssigneeDetails.find({
        taskId: { $in: taskIds },
        user: targetId
    }).lean();

    return tasks.map(task => {
        const personal = personalStatuses.find(p => String(p.taskId) === String(task._id));
        return {
            ...task,
            finalStatus: personal?.status || task.status
        };
    });
};

// פונקציה מיוחדת לעיבוד משימות קבועות
const fetchRecurringTasksForUser = async (targetId, startDate, endDate) => {
    const recurringTasks = await RecurringTask.find({
        assignees: targetId,
        isDeleted: { $ne: true }
    }).lean();

    const processedTasks = [];
    const dateRange = createDateRange(startDate, endDate);

    for (const task of recurringTasks) {
        for (const targetDate of dateRange) {
            const lastNote = getLastDailyUpdateFromNotes(task.notes || [], targetDate);
            
            if (lastNote) {
                processedTasks.push({
                    ...task,
                    finalStatus: lastNote.status,
                    updatedAt: lastNote.date,
                    processedDate: targetDate,
                    isFromRecurringNote: true
                });
            }
        }
    }

    return processedTasks;
};

export const getUserPerformance = async (req, res) => {
    try {
        const {employeeId, rangeType, from, to, groupBy = 'day' } = req.query;
        const targetId = employeeId || req.user.id;
        console.log("Target ID for performance fetch:", targetId);

        console.log("rangeType", rangeType)
        console.log("from", from)
        console.log("to", to)
        console.log("groupBy", groupBy)

        const goals = await Goal.find({
            $or: [
                { targetType: 'כלל העובדים' },
                { targetType: 'עובד בודד', employee: targetId }
            ]
        });

        let startDate, endDate;

        if (from && to) {
            startDate = dayjs(from).startOf('day').toDate();
            endDate = dayjs(to).endOf('day').toDate();
        } else {
            switch (rangeType) {
                case 'week':
                    startDate = dayjs().startOf('week').toDate();
                    endDate = dayjs().endOf('week').toDate();
                    break;
                case 'month':
                    startDate = dayjs().startOf('month').toDate();
                    endDate = dayjs().endOf('month').toDate();
                    break;
                case 'year':
                    startDate = dayjs().startOf('year').toDate();
                    endDate = dayjs().endOf('year').toDate();
                    break;
                case 'day':
                default:
                    startDate = dayjs().startOf('day').toDate();
                    endDate = dayjs().endOf('day').toDate();
            }
        }

        // משיכת כל סוגי המשימות כולל קבועות מעובדות
        const [normalTasks, todayTasks, processedRecurringTasks] = await Promise.all([
            fetchTasksForUserRange(Task, targetId, startDate, endDate),
            fetchTasksForUserRange(TodayTask, targetId, startDate, endDate),
            fetchRecurringTasksForUser(targetId, startDate, endDate),
        ]);

        const allTasks = [...normalTasks, ...todayTasks, ...processedRecurringTasks];

        const goalProgress = goals.map(goal => {
            // סינון משימות שהושלמו בהתאם ליעד
            const matchedTasks = allTasks.filter(task => {
                // בדוק תכונות המשימה מול היעד, לדוגמה חשיבות ותדירות
                if (task.importance !== goal.importance) return false;
                if (task.finalStatus !== 'הושלם') return false;  // הוספת סינון לסטטוס הושלם
                if (goal.targetType === 'עובד בודד' && String(goal.employee) !== String(targetId)) {
                    return false; // לא של העובד הנוכחי
                }
                // תוכל להוסיף גם בדיקת תדירות אם יש לך שדה כזה במשימות
                // לדוגמה, תדירות שבועית – לבדוק שהתאריך נכנס לטווח הנכון
                const updatedAt = dayjs(task.updatedAt);
                if (updatedAt.isBefore(dayjs(startDate)) || updatedAt.isAfter(dayjs(endDate))) return false;
                return true;
            });

            const completedCount = matchedTasks.length;

            // חישוב אחוז עמידה (מקסימום 100%)
            const percentAchieved = goal.targetCount > 0
                ? Math.min((completedCount / goal.targetCount) * 100, 100)
                : 0;

            return {
                goalId: goal._id,
                targetType: goal.targetType,
                importance: goal.importance,
                frequency: goal.frequency,
                targetCount: goal.targetCount,
                completedCount,
                percentAchieved: Number(percentAchieved.toFixed(2))
            };
        });

        // ספירה של משימות שהושלמו
        const completedTasks = allTasks.filter(t => t.finalStatus === 'הושלם');
        const completedCount = completedTasks.length;

        // פילוח לפי חשיבות - רק משימות שהושלמו
        const byImportance = completedTasks.reduce((acc, task) => {
            acc[task.importance] = (acc[task.importance] || 0) + 1;
            return acc;
        }, {});

        // גרף התקדמות יומי וחודשי לפי updatedAt
        const groupFormat = groupBy === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';

        const progress = completedTasks.reduce((acc, task) => {
            const day = dayjs(task.updatedAt).format(groupFormat);
            if (!acc[day]) acc[day] = { date: day, completed: 0 };
            acc[day].completed++;
            return acc;
        }, {});

        // השוואה לימי עבודה קודמים
        // נניח שרוצים להשוות ל-7 ימים לפני תחילת הטווח הנוכחי
        const todayStart = dayjs().startOf('day').toDate();
        const todayEnd = dayjs().endOf('day').toDate();

        const daysToCompare = 7;

        // נקבע את טווח ההשוואה - 7 ימים לפני תחילת הטווח הנוכחי ועד יום לפני תחילת הטווח
        const prevEnd = dayjs(todayStart).subtract(1, 'day').endOf('day').toDate();
        const prevStart = dayjs(prevEnd).subtract(daysToCompare - 1, 'day').startOf('day').toDate();

        const [prevNormalTasks, prevTodayTasks, prevProcessedRecurringTasks] = await Promise.all([
            fetchTasksForUserRange(Task, targetId, prevStart, prevEnd),
            fetchTasksForUserRange(TodayTask, targetId, prevStart, prevEnd),
            fetchRecurringTasksForUser(targetId, prevStart, prevEnd),
        ]);

        const prevAllTasks = [...prevNormalTasks, ...prevTodayTasks, ...prevProcessedRecurringTasks];
        const prevCompletedTasks = prevAllTasks.filter(t => t.finalStatus === 'הושלם');

        const totalPrevDays = dayjs(prevEnd).diff(dayjs(prevStart), 'day') + 1;
        const prevAverage = totalPrevDays > 0 ? (prevCompletedTasks.length / totalPrevDays) : 0;

        // goalProgress הוא מערך עם כל היעדים, כל אחד עם completedCount ו targetCount
        const totalTargetCount = goalProgress.reduce((sum, goal) => sum + goal.targetCount, 0);
        const totalCompletedCount = goalProgress.reduce((sum, goal) => sum + goal.completedCount, 0);

        const overallPercentAchieved = totalTargetCount > 0
            ? Math.min((totalCompletedCount / totalTargetCount) * 100, 100)
            : 0;

        res.json({
            completedCount,
            byImportance,
            prevAverage: Number(prevAverage.toFixed(2)),
            progress: Object.values(progress),
            goalProgress,
            overallPercentAchieved: Number(overallPercentAchieved.toFixed(2)) 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};