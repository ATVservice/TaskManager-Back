import TodayTask from '../models/TodayTask.js';
import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';
import dayjs from 'dayjs';

export const refreshTodayTasks = async () => {
    const today = dayjs().startOf('day').toDate();
    const endOfToday = dayjs().endOf('day').toDate();

    // 1. ריקון טבלה
    await TodayTask.deleteMany({});

    // 2. משימות חד-פעמיות לתאריך היום
    const singleTasks = await Task.find({
        dueDate: { $gte: today, $lte: endOfToday },
        isDeleted: false
    }).lean();

    const recurringTasks = await RecurringTask.find({ isDeleted: false }).lean();

    const todayRecurring = recurringTasks.filter(task => {
        const now = dayjs();

        switch (task.frequencyType) {
            case 'יומי':
                return task.frequencyDetails?.includingFriday || now.day() !== 5;
            case 'יומי פרטני':
                return task.frequencyDetails?.days?.includes(now.day());
            case 'חודשי':
                return now.date() === task.frequencyDetails?.dayOfMonth;
            case 'שנתי':
                return now.date() === task.frequencyDetails?.day && now.month() + 1 === task.frequencyDetails?.month;
            default:
                return false;
        }
    });

    // 3. שילוב למשימות להיום
    const allToday = [
        ...singleTasks.map(task => ({
            ...task,
            sourceTaskId: task._id,
            isRecurringInstance: false
        })),
        ...todayRecurring.map(task => ({
            ...task,
            sourceTaskId: task._id,
            isRecurringInstance: true
        }))
    ];

    await TodayTask.insertMany(allToday);
};
export const getTodayTasks = async (req, res) => {
    const userId = req.user._id;
    const isAdmin = req.user.role === 'מנהל';

    let filter = { isDeleted: false };

    if (!isAdmin) {
        filter = {
            ...filter,
            $or: [
                { mainAssignee: userId },
                { assignees: userId }
            ]
        };
    }

    const tasks = await TodayTask.find(filter)
        .populate('assignees', 'userName')
        .populate('mainAssignee', 'userName')
        .populate('organization', 'name')

    res.status(200).json(tasks);

};
