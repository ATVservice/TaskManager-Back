import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
  taskId: { type: Number, required: true, unique: true }, // מזהה עוקב פנימי
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // מקים המשימה
  createdAt: { type: Date, default: Date.now }, // תאריך יצירה
  dueDate: { type: Date }, // תאריך משימה
  finalDeadline: { type: Date }, // תאריך יעד סופי

  updatedAt: { type: Date, default: Date.now }, // תאריך עדכון
  title: { type: String, required: true }, // כותרת
  details: { type: String }, // פרטים
  importance: {
    type: String,
    enum: ['מיידי', 'מגירה', 'תאריך', 'כללי', 'עקביות'],
    required: true
  },
  subImportance: {
    type: String,
    enum: ['דחוף', 'ממוספר', 'בהקדם האפשרי', 'לפי תאריך'],
  },
  status: {
    type: String,
    enum: ['לביצוע', 'הושלם', 'בטיפול', 'בוטלה'],
    default: 'לביצוע',
    required: true
  },
  statusNote: { type: String, default: "" },
  failureReason: {
    type: {
      option: {
        type: String,
        enum: [
          'חוסר זמן',
          'חופשה',
          'בעיה טכנית',
          'תלות בגורם חיצוני',
          'לא דחוף',
          'אחר'
        ],
        required: false
      },
      customText: {
        type: String,
        required: false
      }
    },
    required: false,
  },
  cancelReason: { type: String },
  followUp: { type: String },
  daysOpen: { type: Number, default: 0 },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Association', required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: false },

  isRecurringInstance: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  hiddenFrom: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // משימות מוסתרות למשתמשים מסוימים

  mainAssignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  comments: [{
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  }],
  updatesHistory: [{
    date: Date,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: String,
    note: String
  }]
});
taskSchema.index({
  isDeleted: 1,
  hiddenFrom: 1,
  mainAssignee: 1,
  assignees: 1,
  creator: 1,
  status: 1,
  dueDate: 1
});

taskSchema.index({
  isDeleted: 1,
  status: 1,
  dueDate: 1,
  mainAssignee: 1
});

taskSchema.index({
  isDeleted: 1,
  status: 1,
  dueDate: 1
});
taskSchema.index({
  isDeleted: 1
});
taskSchema.index({
  isDeleted: 1,
  importance: 1,
  updatedAt: 1
});
taskSchema.index({ assignees: 1 });
taskSchema.index({ creator: 1 });
taskSchema.index({ assignees: 1, dueDate: 1 });




export default mongoose.model('Task', taskSchema);
