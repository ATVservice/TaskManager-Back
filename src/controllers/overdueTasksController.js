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
    const now = dayjs().tz('Asia/Jerusalem');
    const today = now.startOf('day').toDate();
    const yesterday = now.subtract(1, 'day').startOf('day').toDate();
    const yesterdayEnd = now.subtract(1, 'day').endOf('day').toDate();

    console.log(`🌙 Starting overdue detection for ${now.format('YYYY-MM-DD HH:mm')}`);

    // ============================================
    // 1️⃣ משימות רגילות (Task) שעבר תאריך היעד שלהן
    // ============================================
    const overdueSingleTasks = await Task.find({
        dueDate: { $lt: today },
        status: { $nin: ['הושלם', 'בוטלה'] },
        isDeleted: false
    })
        .populate('mainAssignee assignees organization')
        .lean();

    console.log(`📋 Found ${overdueSingleTasks.length} overdue single tasks`);

    // ============================================
    // 2️⃣ TodayTask רגילות (לא קבועות) של אתמול שלא הושלמו
    // ============================================
    const yesterdayTodayTasks = await TodayTask.find({
        createdAt: { $gte: yesterday, $lte: yesterdayEnd },
        taskModel: 'Task', // רק משימות רגילות!
        status: { $nin: ['הושלם', 'בוטלה'] }
    })
        .populate('taskId mainAssignee assignees organization')
        .lean();

    console.log(`📅 Found ${yesterdayTodayTasks.length} yesterday's TodayTasks (regular) that weren't completed`);

    // ============================================
    // 3️⃣ משימות קבועות של אתמול שלא הושלמו
    // ============================================
    const yesterdayRecurringInstances = await TodayTask.find({
        createdAt: { $gte: yesterday, $lte: yesterdayEnd },
        isRecurringInstance: true,
        taskModel: 'RecurringTask',
        status: { $nin: ['הושלם', 'בוטלה'] }
    })
        .populate('sourceTaskId mainAssignee assignees organization')
        .lean();

    console.log(`🔄 Found ${yesterdayRecurringInstances.length} yesterday's recurring instances that weren't completed`);

    // ============================================
    // פונקציה לשמירה ב-DelayedTask
    // ============================================
    const saveIfNotExists = async (task, model, overdueSince) => {
        try {
            // בדיקה אם כבר קיים
            const exists = await DelayedTask.findOne({
                taskId: task._id,
                taskModel: model,
                status: 'pending'
            });

            if (exists) {
                console.log(`⏭️  Already exists: ${task.title || 'ללא כותרת'}`);
                return;
            }

            // וודא שיש organization
            if (!task.organization) {
                console.warn(`Skipping task without organization: ${task.title || 'ללא כותרת'} (${task._id})`);
                return;
            }

            // יצירת רשומה חדשה
            await DelayedTask.create({
                taskId: task._id,
                taskModel: model,
                mainAssignee: task.mainAssignee?._id || null,
                assignedTo: (task.assignees || []).map(a => a._id),
                title: task.title || 'ללא כותרת',
                overdueSince: overdueSince || task.dueDate || today,
                organization: task.organization?._id || task.organization,
                taskNumber: task.taskId || 0,
                status: 'pending'
            });

            console.log(`Added delayed task: ${task.title || 'ללא כותרת'} (${model})`);
        } catch (error) {
            console.error(`rror saving delayed task ${task._id}:`, error);
        }
    };

    // ============================================
    // שמירת כל המשימות המתעכבות
    // ============================================
    
    // 1. משימות רגילות שעבר תאריך היעד
    for (const task of overdueSingleTasks) {
        await saveIfNotExists(task, 'Task', task.dueDate);
    }

    // 2. TodayTask רגילות של אתמול
    for (const todayTask of yesterdayTodayTasks) {
        const originalTask = todayTask.taskId;
        if (!originalTask) {
            console.warn(`TodayTask ${todayTask._id} missing taskId reference`);
            continue;
        }

        // בדוק אם יש TaskAssigneeDetails
        const hasDetails = await TaskAssigneeDetails.exists({
            taskId: originalTask._id,
            taskModel: 'Task'
        });

        if (hasDetails) {
            // בדוק אם כולם סיימו
            const allDetails = await TaskAssigneeDetails.find({
                taskId: originalTask._id,
                taskModel: 'Task'
            }).lean();

            const allCompleted = allDetails.every(d => d.status === 'הושלם');
            if (allCompleted) {
                console.log(`✓ All assignees completed: ${originalTask.title}`);
                continue;
            }
        }

        await saveIfNotExists(originalTask, 'Task', yesterday);
    }

    // 3. משימות קבועות של אתמול
    for (const recurringInstance of yesterdayRecurringInstances) {
        const recurringTask = recurringInstance.sourceTaskId;
        if (!recurringTask) {
            console.warn(`Recurring instance ${recurringInstance._id} missing sourceTaskId`);
            continue;
        }

        // בדוק אם יש note של אתמול עם הושלם
        const yesterdayNote = (recurringTask.notes || []).find(note => {
            const noteDate = dayjs(note.date).tz('Asia/Jerusalem').startOf('day');
            return noteDate.isSame(yesterday, 'day') && note.status === 'הושלם';
        });

        if (yesterdayNote) {
            console.log(`Recurring task completed yesterday: ${recurringTask.title}`);
            continue;
        }

        await saveIfNotExists(recurringTask, 'RecurringTask', yesterday);
    }

    const totalDelayed = await DelayedTask.countDocuments({ status: 'pending' });
    console.log(`\n Overdue detection complete:`);
    console.log(`   - Single tasks: ${overdueSingleTasks.length}`);
    console.log(`   - Yesterday's TodayTasks: ${yesterdayTodayTasks.length}`);
    console.log(`   - Yesterday's recurring: ${yesterdayRecurringInstances.length}`);
    console.log(`   - Total pending in DelayedTask: ${totalDelayed}\n`);
};
// export const detectOverdueTasks = async () => {
//     const now = dayjs().tz("Asia/Jerusalem");
//     const todayStart = now.startOf("day").toDate();
//     const todayEnd = now.endOf("day").toDate();

//     console.log(`🌙 Checking overdue tasks for ${now.format("YYYY-MM-DD")}`);

//     // 🟢 שליפה של כל המשימות להיום (רגילות + קבועות)
//     const todayTasks = await TodayTask.find({
//         date: { $gte: todayStart, $lte: todayEnd },
//         status: { $nin: ["הושלם", "בוטלה"] },
//     })
//         .populate("taskId") // המשימה המקורית
//         .populate("mainAssignee assignees organization")
//         .lean();

//     console.log(`🔎 Found ${todayTasks.length} TodayTasks for today`);

//     for (const todayTask of todayTasks) {
//         const originalTask = todayTask.taskId;
//         if (!originalTask) continue;

//         // 🧩 איסוף כל העובדים במשימה
//         const allAssignees = (todayTask.assignees || []).map(a => a._id.toString());

//         // 🧩 שליפת עובדים שהשלימו מתוך TaskAssigneeDetails
//         const completedDetails = await TaskAssigneeDetails.find({
//             taskId: todayTask.taskId,
//             taskModel: todayTask.taskModel,
//             status: "הושלם",
//         }).lean();

//         const completedAssignees = completedDetails.map(d => d.user.toString());

//         // ✋ סינון העובדים שעוד לא השלימו
//         const pendingAssignees = allAssignees.filter(a => !completedAssignees.includes(a));

//         // אם כולם סיימו – ממשיכים הלאה
//         if (pendingAssignees.length === 0) continue;

//         // 🧹 מחיקת משימה קיימת ב־DelayedTasks (אם קיימת)
//         await DelayedTask.deleteMany({
//             taskId: todayTask.taskId,
//             taskModel: todayTask.taskModel,
//         });

//         // 🆕 יצירה חדשה ב־DelayedTasks
//         await DelayedTask.create({
//             taskId: todayTask.taskId,
//             taskNumber: todayTask.taskNumber || originalTask.taskId || 0,
//             taskModel: todayTask.taskModel,
//             title: todayTask.title || originalTask.title || "ללא כותרת",
//             mainAssignee: todayTask.mainAssignee?._id || originalTask.mainAssignee?._id || null,
//             organization: todayTask.organization?._id || originalTask.organization?._id || null,
//             assignedTo: pendingAssignees,
//             overdueSince: now.toDate(),
//             status: "pending",
//         });

//         console.log(`⏰ Added/Updated delayed task: ${todayTask.title || originalTask.title} (${pendingAssignees.length} pending users)`);
//     }

//     console.log("✅ Finished checking overdue tasks for TodayTask");
// };

// export const detectOverdueTasks = async () => {
//     const now = dayjs().tz("Asia/Jerusalem");
//     const todayStart = now.startOf("day").toDate();
//     const todayEnd = now.endOf("day").toDate();

//     console.log(`🌙 Checking overdue recurring tasks for ${now.format("YYYY-MM-DD")}`);

//     // 1️⃣ שליפת משימות קבועות שעדיין פעילות
//     const recurringTasks = await RecurringTask.find({
//         status: { $nin: ["הושלם", "בוטלה"] },
//         isDeleted: false,
//     })
//         .populate("assignees organization")
//         .lean();

//     for (const task of recurringTasks) {
//         // 2️⃣ סינון ה-notes של היום (מתוך המשימה עצמה)
//         const notesToday = (task.notes || []).filter(
//             (n) => n.date >= todayStart && n.date <= todayEnd
//         );

//         // 3️⃣ עובדים שסיימו היום
//         const completedUsers = notesToday
//             .filter((n) => n.status === "הושלם")
//             .map((n) => n.user?.toString());

//         // 4️⃣ עובדים שלא השלימו
//         const delayedUsers = (task.assignees || []).filter(
//             (user) => !completedUsers.includes(user._id.toString())
//         );

//         // 5️⃣ יצירת רשומות DelayedTask רק למי שעדיין לא השלימו
//         for (const user of delayedUsers) {
//             const exists = await DelayedTask.findOne({
//                 taskId: task._id,
//                 taskModel: "RecurringTask",
//                 userId: user._id,
//                 date: { $gte: todayStart, $lte: todayEnd },
//             });

//             if (!exists) {
//                 await DelayedTask.create({
//                     taskId: task._id,
//                     taskModel: "RecurringTask",
//                     userId: user._id,
//                     title: task.title || "ללא כותרת",
//                     organization: task.organization?._id || task.organization || null,
//                     status: "pending",
//                     date: now.toDate(),
//                     taskNumber: task.taskId,
//                 });


//                 console.log(`⏰ Added delayed recurring task: ${task.title} for ${user.name || user._id}`);
//             }
//         }
//     }

//     console.log("✅ Finished checking overdue recurring tasks");
// };

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

