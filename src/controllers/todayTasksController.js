import TodayTask from '../models/TodayTask.js';
import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import dayjs from 'dayjs';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import mongoose from 'mongoose';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrAfter);
dayjs.extend(isSameOrBefore);
export const refreshTodayTasks = async () => {
  const now = dayjs().tz("Asia/Jerusalem");
  console.log("📅 TZ:", now.format(), "Day index:", now.day());

  const today = now.startOf('day').toDate();
  const endOfToday = now.endOf('day').toDate();

  console.log("🕒 Today range:", today, "→", endOfToday);

  await TodayTask.deleteMany({});

  const singleTasks = await Task.find({
    dueDate: { $gte: today, $lte: endOfToday },
  }).lean();
  console.log(`🔎 Found ${singleTasks.length} single tasks for today`);

  const recurringTasks = await RecurringTask.find({}).lean();
  console.log(`🔄 Found ${recurringTasks.length} recurring tasks total`);

  const todayRecurring = recurringTasks.filter(task => {
    let result = false;
    switch (task.frequencyType) {
      case 'יומי':
        return task.frequencyDetails?.includingFriday
          ? now.day() >= 0 && now.day() <= 5
          : now.day() >= 0 && now.day() <= 4;
      case 'יומי פרטני':
        result = task.frequencyDetails?.days?.includes(now.day());
        break;
      case 'חודשי':
        result = now.date() === task.frequencyDetails?.dayOfMonth;
        break;
      case 'שנתי':
        result = now.date() === task.frequencyDetails?.day && now.month() + 1 === task.frequencyDetails?.month;
        break;
    }
    console.log(`📌 Task "${task.title}" freq=${task.frequencyType} include=${JSON.stringify(task.frequencyDetails)} → ${result}`);
    return result;
  });

  console.log(`✅ Today recurring count: ${todayRecurring.length}`);

  const sanitizeTask = (task, isRecurring) => ({
    ...task,
    sourceTaskId: task._id,
    isRecurringInstance: isRecurring,
    project: task.project && task.project !== "" ? task.project : null,
    taskModel: isRecurring ? 'RecurringTask' : 'Task',
  });

  const allToday = [
    ...singleTasks.map(task => sanitizeTask(task, false)),
    ...todayRecurring.map(task => sanitizeTask(task, true))
  ];

  console.log(`💾 Inserting ${allToday.length} tasks into TodayTask`);
  await TodayTask.insertMany(allToday);
};

export const getTodayTasks = async (req, res) => {
  try {
    const userIdStr = String(req.user._id);
    const isAdmin = req.user.role === 'מנהל';
    const { isRecurringInstance } = req.query;

    const filter = {
      isDeleted: { $ne: true }
    };
    if (!isAdmin) {
      filter.$or = [
        { mainAssignee: req.user._id },
        { assignees: req.user._id },
        { creator: req.user._id },
      ];
      filter.hiddenFrom = { $ne: req.user._id };
    }
    if (isRecurringInstance === 'true') filter.isRecurringInstance = true;
    else if (isRecurringInstance === 'false') filter.isRecurringInstance = false;

    console.log('Filter used:', filter);

    const tasks = await TodayTask.find(filter)
      .populate('assignees', 'userName')
      .populate('mainAssignee', 'userName')
      .populate('organization', 'name')
      .populate('creator', 'userName')
      .populate('project', 'name')
      .lean();

    console.log('Tasks found:', tasks.length);

    const today = dayjs().startOf('day');

    const updated = await Promise.all(
      tasks.map(async (task) => {
        console.log('Processing task:', task._id, task.taskModel);

        // --- מקרה 1: משימה קבועה ---
        if (task.taskModel === 'RecurringTask' && task.sourceTaskId) {
          const recurring = await RecurringTask
            .findById(task.sourceTaskId)
            .select('notes');

          if (recurring?.isDeleted || recurring?.hiddenFrom?.includes(req.user._id)) {
            return null;
          }

          const notes = Array.isArray(recurring?.notes) ? recurring.notes : [];

          // מסננים רק הערות של היום על ידי המשתמש הנוכחי

          const today = dayjs().utc(); // או dayjs().startOf('day') אם רוצים להתחיל מהיום המקומי
          const userNotesToday = notes.filter(n => {
            const noteDate = dayjs(n.date).utc(); // ממיר ל-UTC
            const isToday = noteDate.year() === today.year() &&
              noteDate.month() === today.month() &&
              noteDate.date() === today.date();
            const isUser = n.user && String(n.user) === userIdStr;
            return isToday && isUser;
          });

          if (userNotesToday.length > 0) {
            // מחזירים את הסטטוס של ההערה האחרונה היום
            const last = userNotesToday.sort((a, b) => new Date(b.date) - new Date(a.date))[0];
            task.status = last.status;
          } else {
            task.status = "לביצוע";
          }
        }

        // --- מקרה 2: משימה רגילה ---
        if (task.taskModel === 'Task' && task.sourceTaskId) {
          const originalTask = await Task.findById(task.sourceTaskId).select('status statusNote isDeleted hiddenFrom');

          // בדיקה שהמשימה המקורית לא נמחקה או מוסתרת
          if (originalTask?.isDeleted || originalTask?.hiddenFrom?.includes(req.user._id)) {
            return null; // נסנן אותה מהתוצאות
          }

          const tad = await TaskAssigneeDetails.findOne({
            taskId: task.sourceTaskId,
            taskModel: 'Task',
            user: req.user._id,
          });

          if (tad) {
            const noteDate = dayjs(tad.updatedAt).startOf('day');
            const isToday = noteDate.isSame(today);

            // אם יש עדכון היום בלבד – משתמשים בו, אחרת "לביצוע"
            task.status = isToday ? tad.status : "לביצוע";
            task.statusNote = isToday ? tad.statusNote || '' : '';
          } else {
            const originalTask = await Task.findById(task.sourceTaskId).select('status statusNote');
            task.status = originalTask ? originalTask.status : "לביצוע";
            task.statusNote = originalTask ? originalTask.statusNote || '' : '';
          }
        }

        return task;
      })
    );
    const filteredTasks = updated.filter(task => task !== null);


    console.log('Updated tasks count:', filteredTasks.length);
    res.status(200).json(filteredTasks);

  } catch (err) {
    console.error('getTodayTasks error:', err);
    res.status(500).json({ error: 'שגיאה בשליפת משימות להיום' });
  }
};


export const updateDaysOpen = async () => {
  try {
    console.log('🔄 מתחיל עדכון daysOpen...');

    // בדיקת חיבור
    if (mongoose.connection.readyState !== 1) {
      throw new Error('MongoDB לא מחובר');
    }

    // זמן נוכחי בישראל
    const now = dayjs().tz('Asia/Jerusalem');
    const today = now.startOf('day');

    console.log(`📅 היום: ${today.format('YYYY-MM-DD HH:mm:ss')} (${today.format()})`);

    // שאילתה עם timeout מפורש
    const tasks = await Task.find().maxTimeMS(30000); // 30 שניות timeout
    console.log(`📋 נמצאו ${tasks.length} משימות`);

    if (tasks.length === 0) {
      console.log('אין משימות לעדכן');
      return;
    }

    const bulkOps = tasks.map((task, index) => {
      // המרה של תאריך היצירה לזמן ישראלי
      const createdUTC = dayjs.utc(task.createdAt);
      const createdIsrael = createdUTC.tz('Asia/Jerusalem').startOf('day');
      const daysOpen = today.diff(createdIsrael, 'day');

      // דיבוג למשימה הראשונה
      if (index === 0) {
        console.log('🔍 דיבוג המשימה הראשונה:');
        console.log(`   📝 Task ID: ${task._id}`);
        console.log(`   🌍 createdAt UTC: ${task.createdAt}`);
        console.log(`   🌍 createdAt parsed UTC: ${createdUTC.format('YYYY-MM-DD HH:mm:ss')}`);
        console.log(`   🇮🇱 createdAt בישראל: ${createdIsrael.format('YYYY-MM-DD HH:mm:ss')}`);
        console.log(`   📊 חישוב: ${today.format('YYYY-MM-DD')} - ${createdIsrael.format('YYYY-MM-DD')} = ${daysOpen} ימים`);
      }

      return {
        updateOne: {
          filter: { _id: task._id },
          update: { $set: { daysOpen } },
        },
      };
    });

    // ביצוע העדכון
    const result = await Task.bulkWrite(bulkOps);
    console.log(`✅ עודכנו ${result.modifiedCount} משימות מתוך ${tasks.length}`);

    // בדיקה אחרי העדכון
    const firstTask = await Task.findById(tasks[0]._id);
    console.log(`🔍 בדיקה: המשימה הראשונה עכשיו עם daysOpen = ${firstTask.daysOpen}`);

  } catch (err) {
    console.error('❌ שגיאה בעדכון daysOpen:', err);
  }
};

// פונקציה חלופית פשוטה יותר (בלי timezone plugins)
export const updateDaysOpenSimple = async () => {
  try {
    console.log('🔄 מתחיל עדכון daysOpen (גרסה פשוטה)...');

    // זמן נוכחי + 3 שעות לישראל
    const israelOffset = 3 * 60; // 3 שעות ב-דקות
    const now = dayjs().utcOffset(israelOffset);
    const today = now.startOf('day');

    console.log(`📅 היום: ${today.format('YYYY-MM-DD HH:mm:ss')}`);

    const tasks = await Task.find();
    console.log(`📋 נמצאו ${tasks.length} משימות`);

    if (tasks.length === 0) {
      console.log('אין משימות לעדכן');
      return;
    }

    const bulkOps = tasks.map((task, index) => {
      // המרה של תאריך היצירה לזמן ישראלי
      const created = dayjs(task.createdAt).utcOffset(israelOffset).startOf('day');
      const daysOpen = today.diff(created, 'day');

      // דיבוג למשימה הראשונה
      if (index === 0) {
        console.log('🔍 דיבוג המשימה הראשונה:');
        console.log(`   📝 Task ID: ${task._id}`);
        console.log(`   🌍 createdAt מקורי: ${task.createdAt}`);
        console.log(`   🇮🇱 createdAt בישראל: ${created.format('YYYY-MM-DD HH:mm:ss')}`);
        console.log(`   📊 חישוב: ${today.format('YYYY-MM-DD')} - ${created.format('YYYY-MM-DD')} = ${daysOpen} ימים`);
      }

      return {
        updateOne: {
          filter: { _id: task._id },
          update: { $set: { daysOpen } },
        },
      };
    });

    const result = await Task.bulkWrite(bulkOps);
    console.log(`✅ עודכנו ${result.modifiedCount} משימות מתוך ${tasks.length}`);

  } catch (err) {
    console.error('❌ שגיאה בעדכון daysOpen:', err);
  }
};

// פונקציה לבדיקת חישוב ספציפי
export const debugSpecificTask = async (taskId) => {
  try {
    const task = await Task.findById(taskId);
    if (!task) {
      console.log('❌ משימה לא נמצאה');
      return;
    }

    console.log('🔍 ניתוח מפורט של המשימה:');
    console.log(`📝 Task ID: ${task._id}`);
    console.log(`🌍 createdAt מקורי: ${task.createdAt}`);
    console.log(`📊 daysOpen נוכחי: ${task.daysOpen}`);

    // חישובים שונים
    const now = new Date();
    const created = new Date(task.createdAt);

    console.log('\n📊 חישובים:');
    console.log(`   JavaScript Date.now(): ${now}`);
    console.log(`   JavaScript created: ${created}`);
    console.log(`   הפרש במילישניות: ${now - created}`);
    console.log(`   הפרש בימים (JavaScript): ${Math.floor((now - created) / (1000 * 60 * 60 * 24))}`);

    const todayDayjs = dayjs();
    const createdDayjs = dayjs(task.createdAt);
    console.log(`   dayjs היום: ${todayDayjs.format()}`);
    console.log(`   dayjs נוצר: ${createdDayjs.format()}`);
    console.log(`   dayjs הפרש: ${todayDayjs.diff(createdDayjs, 'day')}`);

    const todayIsrael = dayjs().utcOffset(180); // +3 שעות
    const createdIsrael = dayjs(task.createdAt).utcOffset(180);
    console.log(`   dayjs ישראל היום: ${todayIsrael.format()}`);
    console.log(`   dayjs ישראל נוצר: ${createdIsrael.format()}`);
    console.log(`   dayjs ישראל הפרש: ${todayIsrael.diff(createdIsrael, 'day')}`);

  } catch (err) {
    console.error('❌ שגיאה בדיבוג:', err);
  }
};


