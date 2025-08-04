import mongoose from 'mongoose';

const taskAssigneeDetailsSchema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'taskModel' },
  taskModel: { type: String, required: true, enum: ['Task', 'TodayTask', 'RecurringTask'] },

  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['בתהליך', 'הושלם', 'מושהה', 'בטיפול', 'בוטלה'], default: 'בתהליך' },
  statusNote: { type: String },
  hidden: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('TaskAssigneeDetails', taskAssigneeDetailsSchema);
