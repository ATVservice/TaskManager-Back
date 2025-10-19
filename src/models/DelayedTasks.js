import mongoose from 'mongoose';

const delayedTaskSchema = new mongoose.Schema({
    taskId: { type: mongoose.Schema.Types.ObjectId, required: true },
    taskNumber: { type: Number, required: true, unique: true },
    taskModel: { type: String, enum: ['Task', 'RecurringTask'], required: true },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // רשימה של כל האחראים
    mainAssignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // אחראי ראשי
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Association', required: true },
    title: String,
    overdueSince: Date,
    createdAt: { type: Date, default: Date.now },
    resolvedAt: Date,
    status: { type: String, default: 'pending' }, // pending / completed
});

export default mongoose.model('DelayedTask', delayedTaskSchema);
