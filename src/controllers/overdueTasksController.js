import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';
import TodayTask from '../models/TodayTask.js';
import DelayedTask from '../models/DelayedTasks.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import { updateTask } from './updateTaskController.js';
import { updateRecurringTask } from './updateRecurringTaskController.js'

dayjs.extend(utc);
dayjs.extend(timezone);


export const detectOverdueTasks = async () => {
    const now = dayjs().tz("Asia/Jerusalem");
    const todayStart = now.startOf("day").toDate();
    const todayEnd = now.endOf("day").toDate();

    console.log(`🌙 Checking overdue recurring tasks for ${now.format("YYYY-MM-DD")}`);

    // 1️⃣ שליפת משימות קבועות שעדיין פעילות
    const recurringTasks = await RecurringTask.find({
        status: { $nin: ["הושלם", "בוטלה"] },
        isDeleted: false,
    })
        .populate("assignees organization")
        .lean();

    for (const task of recurringTasks) {
        // 2️⃣ סינון ה-notes של היום (מתוך המשימה עצמה)
        const notesToday = (task.notes || []).filter(
            (n) => n.date >= todayStart && n.date <= todayEnd
        );

        // 3️⃣ עובדים שסיימו היום
        const completedUsers = notesToday
            .filter((n) => n.status === "הושלם")
            .map((n) => n.user?.toString());

        // 4️⃣ עובדים שלא השלימו
        const delayedUsers = (task.assignees || []).filter(
            (user) => !completedUsers.includes(user._id.toString())
        );

        // 5️⃣ יצירת רשומות DelayedTask רק למי שעדיין לא השלימו
        for (const user of delayedUsers) {
            const exists = await DelayedTask.findOne({
                taskId: task._id,
                taskModel: "RecurringTask",
                userId: user._id,
                date: { $gte: todayStart, $lte: todayEnd },
            });

            if (!exists) {
                await DelayedTask.create({
                    taskId: task._id,
                    taskModel: "RecurringTask",
                    userId: user._id,
                    title: task.title || "ללא כותרת",
                    organization: task.organization?._id || task.organization || null,
                    status: "pending",
                    date: now.toDate(),
                });

                console.log(`⏰ Added delayed recurring task: ${task.title} for ${user.name || user._id}`);
            }
        }
    }

    console.log("✅ Finished checking overdue recurring tasks");
};

// export const detectOverdueTasks = async () => {
//     const now = dayjs().tz('Asia/Jerusalem');
//     const today = now.startOf('day').toDate();
//     const yesterday = now.subtract(1, 'day').startOf('day').toDate();


//     // --- משימות רגילות ---
//     const singleTasks = await Task.find({ dueDate: { $lt: today }, isDeleted: false })

//         .populate('mainAssignee assignees organization')

//         .lean();

//     // סינון לפי מי שסיים (TaskAssigneeDetails)
//     const overdueSingleTasks = singleTasks.filter((task) => {
//         const allDetails = task.taskAssigneeDetails || [];
//         const everyoneCompleted = allDetails.every((d) => d.status === 'הושלם');
//         return !everyoneCompleted; // נשארו שלא סיימו
//     });

//     // --- משימות קבועות אתמול ---
//     const yesterdayRecurringInstances = await TodayTask.find({
//         isRecurringInstance: true,
//         taskModel: 'RecurringTask',
//         createdAt: { $gte: yesterday, $lt: today },
//         status: { $ne: 'הושלם' },
//     })
//         .populate('sourceTaskId mainAssignee assignees organization')
//         .lean();
//     // 🟢 משימות קבועות של היום שלא הושלמו
//     const todayRecurringInstances = await TodayTask.find({
//         isRecurringInstance: true,
//         taskModel: 'RecurringTask',
//         status: { $nin: ['הושלם', 'בוטלה'] },
//     })
//         .populate('sourceTaskId mainAssignee assignees organization')
//         .lean();

//     const overdueRecurringTasks = [];
//     for (const t of yesterdayRecurringInstances) {
//         const recurring = t.sourceTaskId;
//         if (!recurring) continue;

//         const userCompletedYesterday = recurring.notes?.some((note) => {
//             const noteDate = dayjs(note.date).tz('Asia/Jerusalem').startOf('day');
//             return noteDate.isSame(yesterday, 'day') && note.status === 'הושלם';
//         });

//         if (!userCompletedYesterday) {
//             overdueRecurringTasks.push(recurring);
//         }
//     }

//     // --- שמירה בטבלת DelayedTasks ---
//     const saveIfNotExists = async (task, model) => {
//         const exists = await DelayedTask.findOne({
//             taskId: task._id,
//             taskModel: model,
//             status: 'pending',
//         });
//         if (!exists) {

//             if (!task.organization) {
//                 console.warn(`⚠️ Missing organization for task ${task._id} (${task.title || 'ללא כותרת'})`);
//                 console.warn(`🔎 Full task data:`, task);
//                 return;
//             }



//             await DelayedTask.create({
//                 taskId: task._id,
//                 taskModel: model,
//                 mainAssignee: task.mainAssignee?._id || null,
//                 assignedTo: task.assignees?.map((a) => a._id) || [],
//                 title: task.title || 'ללא כותרת',
//                 overdueSince: task.dueDate || new Date(),
//                 organization: task.organization?._id || task.organization || null,
//                 taskNumber: task.taskId || 0,
//                 status: 'pending',

//             });
//         }
//     };

//     for (const t of overdueSingleTasks) await saveIfNotExists(t, 'Task');
//     for (const t of overdueRecurringTasks) await saveIfNotExists(t, 'RecurringTask');

//     console.log(
//         `✅ Overdue tasks recorded: ${overdueSingleTasks.length} single, ${overdueRecurringTasks.length} recurring`
//     );
// };

export const getOverdueTasksForUser = async (req, res) => {
    try {
        const userId = req.user._id;

        // שליפת כל המשימות המתעכבות מה־DelayedTasks עבור המשתמש
        const delayedTasks = await DelayedTask.find({
            status: 'pending',
            $or: [
                { mainAssignee: userId },
                { assignedTo: userId }
            ]
        })
            .populate('mainAssignee', 'userName')
            .populate('organization', 'name')
            .lean();

        const tasksWithUserStatus = [];

        for (const dt of delayedTasks) {
            let userStatus = 'לביצוע';

            if (dt.taskModel === 'Task') {
                // עבור משימות רגילות - בדוק ב-TaskAssigneeDetails
                const assigneeDetail = await TaskAssigneeDetails.findOne({
                    taskId: dt.taskId,
                    taskModel: 'Task',
                    user: userId
                }).lean();

                if (assigneeDetail) {
                    userStatus = assigneeDetail.status;
                } else {
                    // אם אין בטבלה, קח מהסטטוס של המשימה עצמה
                    const task = await Task.findById(dt.taskId).lean();
                    if (task) userStatus = task.status;
                }
            } else if (dt.taskModel === 'RecurringTask') {
                // עבור משימות קבועות - בדוק ב-notes
                const recurringTask = await RecurringTask.findById(dt.taskId).lean();
                if (recurringTask) {
                    const note = recurringTask.notes?.find(n => n.user.toString() === userId.toString());
                    if (note) userStatus = note.status;
                    else userStatus = recurringTask.status;
                }
            }

            tasksWithUserStatus.push({
                ...dt,
                userStatus
            });
        }

        // ממיין לפי תאריך העיכוב
        tasksWithUserStatus.sort((a, b) => new Date(a.overdueSince) - new Date(b.overdueSince));

        res.status(200).json({
            success: true,
            totalCount: tasksWithUserStatus.length,
            tasks: tasksWithUserStatus
        });

    } catch (error) {
        console.error('❌ Error fetching overdue tasks for user:', error);
        res.status(500).json({
            success: false,
            message: 'שגיאה בשליפת משימות מתעכבות',
            error: error.message
        });
    }
};

export async function populateDelayedTasks() {
    try {
        const now = dayjs().tz('Asia/Jerusalem').toDate();
        console.log('🌙 Populating DelayedTasks...');

        // שליפת כל המשימות הרגילות שלא הושלמו
        const tasks = await Task.find({
            dueDate: { $lt: now },
            isDeleted: false,
            status: { $nin: ['הושלם', 'בוטלה'] },
        }).lean();

        console.log(`🔎 Found ${tasks.length} tasks in history`);

        let countAdded = 0;

        for (const task of tasks) {
            // בודק אם העובדים סיימו במשימה דרך TaskAssigneeDetails
            const assigneeDetails = await TaskAssigneeDetails.find({
                taskId: task._id,
                taskModel: 'Task',
                status: 'הושלם',
            }).lean();

            // אם יש עובדים שהשלימו – נשמור רק את מי שלא השלימו
            const allAssignees = task.assignees.map(a => a.toString());
            const completedAssignees = assigneeDetails.map(d => d.user.toString());
            const pendingAssignees = allAssignees.filter(a => !completedAssignees.includes(a));

            if (pendingAssignees.length > 0) {
                // בדיקה אם כבר קיים ב-DelayedTasks
                const exists = await DelayedTask.findOne({
                    taskId: task._id,
                    taskModel: 'Task',
                    status: 'pending',
                });

                if (!exists) {
                    await DelayedTask.create({
                        taskId: task._id,
                        taskNumber: task.taskId,
                        organization: task.organization,
                        taskModel: 'Task',
                        mainAssignee: task.mainAssignee,
                        assignedTo: pendingAssignees,
                        title: task.title,
                        overdueSince: task.dueDate,
                        status: 'pending',
                    });
                    countAdded++;
                }
            }
        }

        console.log(`✅ Added ${countAdded} overdue tasks to DelayedTasks`);
    } catch (err) {
        console.error('❌ Error populating delayed tasks:', err);
    }
}

export const updateStatusWithDelayedLogic = async (req, res) => {
    try {
        const { taskId } = req.params;
        const { model } = req.body;
        const user = req.user;

        // מציאת המשימה
        const task = await Task.findById(taskId);
        if (!task) {
            res.status(404);
            throw new Error('משימה לא נמצאה');
        }

        // פונקציה עזר: לבדוק אם המשתמש הוא מנהל/אחראי ראשי/יוצר
        const isPrivilegedUser = () => {
            const userIdStr = String(user._id);
            const mainAssigneeId = task.mainAssignee ? String(task.mainAssignee) : null;
            const creatorId = task.creator ? String(task.creator) : null;
            return ['מנהל'].includes(user.role) || userIdStr === mainAssigneeId || userIdStr === creatorId;
        };

        if (isPrivilegedUser()) {
            // למשתמשים בעלי הרשאה מלאה: מוחקים את המשימה מ-DelayedTask
            await DelayedTask.deleteMany({ taskId: task._id });
            console.log(`✅ DelayedTask for task ${taskId} deleted by privileged user ${user._id}`);
        } else {
            // למשתמשים רגילים: רק להסיר את המשתמש מהרשימה assignedTo
            await DelayedTask.updateMany(
                { taskId: task._id },
                { $pull: { assignedTo: user._id } }
            );
            console.log(`✅ User ${user._id} removed from DelayedTask.assignedTo for task ${taskId}`);
        }

        // בסוף: קריאה לפונקציית העדכון הרגילה
        if (model === 'Task')
            return await updateTask(req, res);
        else if (model === 'RecurringTask') {
            return await updateRecurringTask(req, res);
        }

    } catch (err) {
        console.error('updateTaskWithDelayedLogic error:', err);
        const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
        res.status(statusCode).json({ message: err.message || 'שגיאה בעדכון המשימה' });
    }
};
export const updatedueDateWithDelayedLogic = async (req, res) => {
    try {
        const { taskId } = req.params;
        const { model } = req.body;
        const user = req.user;

        // מציאת המשימה
        const task = await Task.findById(taskId);
        if (!task) {
            res.status(404);
            throw new Error('משימה לא נמצאה');
        }

        // פונקציה עזר: לבדוק אם המשתמש הוא מנהל/אחראי ראשי/יוצר
        await DelayedTask.deleteMany({ taskId: task._id });
        console.log(`✅ DelayedTask for task ${taskId} deleted by privileged user ${user._id}`);

        // בסוף: קריאה לפונקציית העדכון הרגילה
        if (model === 'Task')
            return await updateTask(req, res);
        else if (model === 'RecurringTask') {
            return await updateRecurringTask(req, res);
        }

    } catch (err) {
        console.error('updateTaskWithDelayedLogic error:', err);
        const statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
        res.status(statusCode).json({ message: err.message || 'שגיאה בעדכון המשימה' });
    }
};

