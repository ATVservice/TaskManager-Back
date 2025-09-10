import RecurringTask from '../models/RecurringTask.js';
import TaskRecurringHistory from '../models/TaskRecurringHistory.js';
import { getTaskPermissionLevel } from '../utils/taskPermissions.js';

export const getRecurringTaskHistory = async (req, res) => {
    try {
        const { taskId } = req.params;
        const user = req.user;

        // שליפת המשימה הקבועה
        const task = await RecurringTask.findById(taskId);
        if (!task) {
            return res.status(404).json({ message: 'משימה קבועה לא נמצאה' });
        }

        // בדיקת הרשאות
        const permission = getTaskPermissionLevel(task, user);
        if (permission === 'none') {
            return res.status(403).json({ message: 'אין לך הרשאה לראות משימה זו' });
        }

        // ---------- שליפת היסטוריה מ-TaskRecurringHistory ----------
        let historyQuery = { taskId };
        if (permission === 'limited') {
            // אחראי משני – יראה רק את ההיסטוריה האישית שלו
            historyQuery.user = user._id;
        }

        const historyRecords = await TaskRecurringHistory.find(historyQuery)
            .populate('user', 'userName')
            .lean();

        // ---------- שליפת notes מהמשימה ----------
        let notesRecords = [];
        
        if (permission === 'full') {
            // מנהל/יוצר/אחראי ראשי - רואים את כל ה-notes
            notesRecords = task.notes || [];
        } else if (permission === 'limited') {
            // אחראי משני - רואה רק את ה-notes שלו
            notesRecords = (task.notes || []).filter(note => 
                String(note.user) === String(user._id)
            );
        }

        // ---------- המרת notes לפורמט של TaskRecurringHistory ----------
        const notesAsHistory = [];
        
        for (let i = 0; i < notesRecords.length; i++) {
            const note = notesRecords[i];
            
            // עבור כל note, נבדוק מה היה הסטטוס הקודם
            let previousStatus = null;
            
            // מחפשים בעדכונים הקודמים (לפי תאריך)
            const previousNotes = notesRecords
                .filter(n => new Date(n.date) < new Date(note.date))
                .sort((a, b) => new Date(b.date) - new Date(a.date));
            
            if (previousNotes.length > 0) {
                previousStatus = previousNotes[0].status;
            }
            
            // אם אין עדכון קודם, נביא מהסטטוס הגלובלי הראשוני של המשימה
            if (!previousStatus) {
                // אפשר להגדיר ברירת מחדל או לקחת מהמשימה עצמה
                previousStatus = 'לביצוع'; // ברירת מחדל
            }

            // יצירת רשומת היסטוריה עבור שינוי סטטוס
            if (note.status) {
                notesAsHistory.push({
                    _id: `note_status_${note._id || i}`,
                    taskId,
                    user: {
                        _id: note.user,
                        userName: note.user?.userName || 'לא ידוע' // יצטרך populate
                    },
                    field: 'סטטוס',
                    before: previousStatus,
                    after: note.status,
                    date: note.date
                });
            }

            // יצירת רשומת היסטוריה עבור הערה (אם קיימת)
            if (note.content && note.content.trim()) {
                notesAsHistory.push({
                    _id: `note_content_${note._id || i}`,
                    taskId,
                    user: {
                        _id: note.user,
                        userName: note.user?.userName || 'לא ידוע' // יצטרך populate
                    },
                    field: 'הערה סטטוס',
                    before: null, // הערות בדרך כלל לא מחליפות ערך קודם
                    after: note.content,
                    date: note.date
                });
            }
        }

        // ---------- populate משתמשים עבור ה-notes ----------
        const userIds = [...new Set(notesAsHistory.map(n => String(n.user._id)))];
        if (userIds.length > 0) {
            const User = (await import('../models/User.js')).default;
            const users = await User.find({ _id: { $in: userIds } }).select('_id userName').lean();
            const userMap = new Map(users.map(u => [String(u._id), u.userName]));
            
            // עדכון שמות המשתמשים
            notesAsHistory.forEach(record => {
                const userId = String(record.user._id);
                record.user.userName = userMap.get(userId) || 'לא ידוע';
            });
        }

        // ---------- איחוד ההיסטוריה ----------
        const allHistory = [
            ...historyRecords.map(h => ({
                _id: h._id,
                taskId: h.taskId,
                user: h.user,
                field: h.field,
                before: h.before,
                after: h.after,
                date: h.date
            })),
            ...notesAsHistory
        ];

        // ---------- מיון לפי תאריך (מהחדש לישן) ----------
        allHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({ history: allHistory });

    } catch (err) {
        console.error('getRecurringTaskHistory error:', err);
        res.status(500).json({ message: 'שגיאה בשליפת היסטוריית משימה קבועה' });
    }
};