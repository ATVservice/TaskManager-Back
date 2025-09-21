import Task from '../models/Task.js';
import RecurringTask from '../models/RecurringTask.js';

export const addComment = async (req, res) => {
    const userId = req.user._id;
    const {_id, type, content} = req.body;

    const Model = type === 'recurring' ? RecurringTask : Task;

    const doc = await Model.findById(_id);

    if (!doc) throw new Error(`${type === 'recurring' ? 'משימה חוזרת' : 'משימה'} לא נמצאה`);

    doc.comments.push({
        content,
        createdBy: userId
    });

    await doc.save();
    res.status(201).json({
        message: 'הערה נוספה בהצלחה',
      });
};

export const getComments = async (req, res) => {
    const {_id, type} = req.query;
    const Model = type === 'recurring' ? RecurringTask : Task;

    const doc = await Model.findById(_id)
        .populate('comments.createdBy', 'userName');

    if (!doc) throw new Error(`${type === 'recurring' ? 'משימה חוזרת' : 'משימה'} לא נמצאה`);
    return res.status(200).json(doc);

 };
