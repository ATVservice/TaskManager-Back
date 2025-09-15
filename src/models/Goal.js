import mongoose from 'mongoose';

const goalSchema = new mongoose.Schema({

  // האם היעד הוא לכל הארגון או לעובד ספציפי
  targetType: { 
    type: String,
    enum: ['עובד בודד', 'כלל העובדים'],
    required: true
  },

  // אם זה לעובד ספציפי
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // סוג משימה (מיידי, מגירה וכו')
  importance: { 
    type: String, 
    enum: ['מיידי', 'מגירה', 'תאריך', 'כללי', 'עקביות'], 
    required: true 
  },

  // תת סוג (למשל: דחוף)
  subImportance: { 
    type: String,
    enum: ['דחוף', 'ממוספר', 'בהקדם האפשרי', 'לפי תאריך'],
  },

  // תדירות (יומי, שבועי, חודשי)
  frequency: {
    type: String,
    enum: ['יומי', 'שבועי', 'חודשי'],
    required: true
  },

  // כמות משימות ביעד
  targetCount: { type: Number, required: true },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

export default mongoose.model('Goal', goalSchema);
