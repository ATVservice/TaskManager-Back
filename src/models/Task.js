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
  },
  subImportance: {
    type: String,
    enum: ['דחוף', 'ממוספר', 'בהקדם האפשרי', 'לפי תאריך'],
  },
  status: {
    type: String,
    enum: ['בתהליך', 'הושלם', 'מושהה', 'בטיפול', 'בוטלה'],
    default: 'בתהליך',
  },
  statusNote: { type: String },
  failureReason: { type: String },
  followUp: { type: String },
  daysOpen: { type: Number, default: 0 },
  organization: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Association' }],
  project: { type: String },
  isRecurringInstance: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },

  mainAssignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  updatesHistory: [{
    date: Date,
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: String,
    note: String
  }]
});

export default mongoose.model('Task', taskSchema);
