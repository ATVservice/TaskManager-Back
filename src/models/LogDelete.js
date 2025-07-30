import mongoose from 'mongoose';

const logDeleteSchema = new mongoose.Schema({
  taskId: Number,
  taskRef: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
  action: { type: String, enum: ['מחיקה', 'שחזור'], required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, default: Date.now },
});

export default mongoose.model('LogDelete', logDeleteSchema);
