import Task from '../models/Task.js';
import TodayTask from '../models/TodayTask.js';
import RecurringTask from '../models/RecurringTask.js';

const getBaseFilter = (user) => {
    if (user.role === 'מנהל') {
        return { isDeleted: false };
    }

    return {
        isDeleted: false,
        $or: [
            { mainAssignee: user._id },
            { assignees: user._id },
            { creator: user._id }

        ]
    };
};
const getBaseTodayFilter = (user) => {
    if (user.role === 'מנהל') return {};
    return {
      $or: [
        { mainAssignee: user._id },
        { assignees: user._id },
        { creator: user._id }
      ]
    };
  };
  
// הושלמו
export const getCompletedTasks = async (req, res) => {
    const userId = req.user._id;
    const isAdmin = req.user.role === 'מנהל';

    const filter = {
        ...getBaseFilter(req.user),
        status: 'הושלם',
    };

    const baseRecurringFilter = {
        status: 'הושלם',
        isRecurringInstance: true,
        ...getBaseTodayFilter(req.user)

    };

    const singleTasks = await Task.find(filter)
        // .select('_id taskId title organization mainAssignee status')
        .populate('mainAssignee', 'userName')
        .populate('assignees', 'userName')
        .populate('organization', 'name')
        // .populate('creator', 'userName');


    const recurringToday = await TodayTask.find(baseRecurringFilter)
        .select('_id taskId title organization mainAssignee status')
        .populate('mainAssignee', 'userName')
        .populate('assignees', 'userName')
        .populate('organization', 'name')
        // .populate('creator', 'userName');


    const all = [...singleTasks, ...recurringToday];

    res.json(all);
};

// בוטלו
export const getCancelledTasks = async (req, res) => {
    const userId = req.user._id;
    const isAdmin = req.user.role === 'מנהל';

    const filter = {
        ...getBaseFilter(req.user),
        status: 'בוטלה',
    };

    const baseRecurringFilter = {
        status: 'בוטלה',
        isRecurringInstance: true,
        ...getBaseTodayFilter(req.user)
    };


    const singleTasks = await Task.find(filter)
        // .select('_id taskId title organization mainAssignee status')
        .populate('mainAssignee', 'userName')
        .populate('assignees', 'userName')
        .populate('organization', 'name')
        // .populate('creator', 'userName');


    const recurringToday = await TodayTask.find(baseRecurringFilter)
        .select('_id taskId title organization mainAssignee status')
        .populate('mainAssignee', 'userName')
        .populate('assignees', 'userName')
        .populate('organization', 'name')
        // .populate('creator', 'userName');


    const all = [...singleTasks, ...recurringToday];

    res.json(all);
};

// מגירה
export const getDrawerTasks = async (req, res) => {
    const userId = req.user._id;
    const isAdmin = req.user.role === 'מנהל';

    const filter = {
        ...getBaseFilter(req.user),
        importance: 'מגירה',
    };

    const baseRecurringFilter = {
        importance: 'מגירה',
        isRecurringInstance: true,
        ...getBaseTodayFilter(req.user)
    };



    const singleTasks = await Task.find(filter)
        // .select('_id taskId title organization mainAssignee status')
        .populate('mainAssignee', 'userName')
        .populate('assignees', 'userName')
        .populate('organization', 'name')
        // .populate('creator', 'userName');


    const recurringToday = await TodayTask.find(baseRecurringFilter)
        .select('_id taskId title organization mainAssignee status')
        .populate('mainAssignee', 'userName')
        .populate('assignees', 'userName')
        .populate('organization', 'name')
        // .populate('creator', 'userName');


    const all = [...singleTasks, ...recurringToday];

    res.json(all);
};
export const getRecurringTasks = async (req, res) => {
    const userId = req.user._id;
    const isAdmin = req.user.role === 'מנהל';

    const filter = {
        ...getBaseFilter(req.user),
    };

    const tasks = await RecurringTask.find(filter)
        // .select('_id taskId title organization mainAssignee status')
        .populate('assignees', 'userName')
        .populate('mainAssignee', 'userName')
        .populate('organization', 'name')
        // .populate('creator', 'userName');


    res.status(200).json(tasks);
};

