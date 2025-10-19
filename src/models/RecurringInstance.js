import mongoose from 'mongoose';

const recurringInstanceSchema = new mongoose.Schema({
  recurringTask: { type: mongoose.Schema.Types.ObjectId, ref: 'RecurringTask', required: true },
  date: { type: Date, required: true },             
  assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  completedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }],
  status: { type: String, enum: ['לביצוע','הושלם','בוטלה'], default: 'לביצוע' },
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

export default mongoose.model('RecurringInstance', recurringInstanceSchema);
