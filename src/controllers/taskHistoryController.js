import Task from '../models/Task.js';
import TaskHistory from '../models/TaskHistory.js';
import { getTaskPermissionLevel } from '../utils/taskPermissions.js';
import TodayTask from '../models/TodayTask.js';

export const getTaskHistory = async (req, res) => {
    try {
        const { taskId } = req.params;
        const user = req.user;

        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: 'משימה לא נמצאה' });

        const permission = getTaskPermissionLevel(task, user);
        if (permission === 'none') {
            return res.status(403).json({ message: 'אין לך הרשאה לראות משימה זו' });
          }
          
        let query = { taskId };

        if (permission === 'limited') {
            // אחראי משני – יראה רק את ההיסטוריה האישית שלו
            query = {
                taskId,
                user: user._id,
            };
        }

        const history = await TaskHistory.find(query)
            .sort({ date: -1 })
            .populate('user', 'userName')
            .lean();

        res.json({ history });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'שגיאה בשליפת היסטוריה' });
    }
};
