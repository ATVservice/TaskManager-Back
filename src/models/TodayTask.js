import mongoose from 'mongoose';

const todayTaskSchema = new mongoose.Schema({
  taskId: { type: Number, required: true }, // מספר משימה פנימי (גם לקבועות וגם לחד"פ)
  sourceTaskId: { type: mongoose.Schema.Types.ObjectId, required: true }, // הפניה למשימה המקורית - RecurringTask או Task
  taskModel: { type: String, enum: ['Task', 'RecurringTask'], required: true },
  isRecurringInstance: { type: Boolean, default: false }, // אם נוצר ממשימה קבועה
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // מקים המשימה

  title: { type: String, required: true },
  details: { type: String },
  importance: { type: String, enum: ['מיידי', 'מגירה', 'תאריך', 'כללי', 'עקביות'], required: true },
  subImportance: { type: String, enum: ['דחוף', 'ממוספר', 'בהקדם האפשרי', 'לפי תאריך'] },
  status: {
    type: String,
    enum: ['לביצוע', 'הושלם', 'בטיפול', 'בוטלה'],
    default: 'לביצוע',
    required: true,
  },
  isDeleted: { type: Boolean, default: false },
  hiddenFrom: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  dueDate: { type: Date }, // רק עבור חד"פ
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Association', required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: false },

  mainAssignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],

  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('TodayTask', todayTaskSchema);
