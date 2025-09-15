import mongoose from 'mongoose';

const taskRecurringHistorySchema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  field: String,
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  date: { type: Date, default: Date.now }
});

export default mongoose.model('TaskRecurringHistory', taskRecurringHistorySchema);
