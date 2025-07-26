import mongoose from 'mongoose';

const recurringTaskSchema = new mongoose.Schema({
  taskId: { type: Number, required: true, unique: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  details: { type: String },
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
  organization: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Association' }],
  project: { type: String },
  mainAssignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  frequencyType: {
    type: String,
    enum: ['יומי', 'יומי פרטני', 'חודשי', 'שנתי'],
    required: true,
  },
  frequencyDetails: {
    days: [Number], // לדוג' [0,2,4] עבור ימי ראשון, שלישי, חמישי
    dayOfMonth: Number, // עבור חודשי
    day: Number, // עבור שנתי (יום)
    month: Number, // עבור שנתי (חודש)
    includeFridays: { type: Boolean } // ליומי
  },

  nextRunDate: { type: Date }, // למעקב מתי לרנדר אותה שוב
  isDeleted: { type: Boolean, default: false }
});

export default mongoose.model('RecurringTask', recurringTaskSchema);
