import mongoose from 'mongoose';

const recurringTaskSchema = new mongoose.Schema({
  taskId: { type: Number, required: true, unique: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  details: { type: String },
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
    enum: ['בתהליך', 'הושלם', 'מושהה', 'בטיפול', 'בוטלה'],
    default: 'בתהליך',
    required: true
  },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Association', required: true },
  project: { type: String },
  mainAssignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],

  frequencyType: {
    type: String,
    enum: ['יומי', 'יומי פרטני', 'חודשי', 'שנתי'],
    required: true,
  },
  frequencyDetails: {
    includingFriday: Boolean, // ליומי
    days: [Number], //ליומי פרטני: לדוג' [1,3,5] עבור ימי ראשון, שלישי, חמישי 
    dayOfMonth: Number, // עבור חודשי
    day: Number, // עבור שנתי (יום)
    month: Number, // עבור שנתי (חודש)
  },

  nextRunDate: { type: Date }, // למעקב מתי לרנדר אותה שוב
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  hiddenFrom: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    updatesHistory: [{
      date: Date,
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      status: String,
      note: String
    }]
});

export default mongoose.model('RecurringTask', recurringTaskSchema);
