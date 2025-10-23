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
  // קשור שיהיה פה סטטוס? לבדוק את זה!
  status: {
    type: String,
    enum: ['לביצוע', 'הושלם', 'בטיפול', 'בוטלה'],
    default: 'לביצוע',
    required: true
  },
  statusNote: { type: String , require:false},

  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Association', required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: false },
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
  notes: [{
    date: { type: Date, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['לביצוע', 'הושלם', 'בטיפול', 'בוטלה'], required: true },
    content: { type: String }
  }], 
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
recurringTaskSchema.index({ dueDate: 1 });


export default mongoose.model('RecurringTask', recurringTaskSchema);
