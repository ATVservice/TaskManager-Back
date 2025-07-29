import mongoose from 'mongoose';

const todayTaskSchema = new mongoose.Schema({
  taskId: { type: Number, required: true }, // מספר משימה פנימי (גם לקבועות וגם לחד"פ)
  sourceTaskId: { type: mongoose.Schema.Types.ObjectId, required: true }, // הפניה למשימה המקורית - RecurringTask או Task
  isRecurringInstance: { type: Boolean, default: false }, // אם נוצר ממשימה קבועה

  title: { type: String, required: true },
  details: { type: String },
  importance: { type: String, enum: ['מיידי', 'מגירה', 'תאריך', 'כללי', 'עקביות'], required: true },
  subImportance: { type: String, enum: ['דחוף', 'ממוספר', 'בהקדם האפשרי', 'לפי תאריך'] },
  status: {
    type: String,
    enum: ['בתהליך', 'הושלם', 'מושהה', 'בטיפול', 'בוטלה'],
    default: 'בתהליך',
    required: true,
  },

  dueDate: { type: Date }, // רק עבור חד"פ
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Association', required: true },
  project: { type: String },

  mainAssignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],

  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('TodayTask', todayTaskSchema);
