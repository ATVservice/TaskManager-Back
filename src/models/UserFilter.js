import mongoose from 'mongoose';

const userFilterSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  screenType: {
    type: String,
    required: true,
    enum: [
      'openTasks',
      'completedTasks', 
      'overdueTasks',
      'tasksByEmployee',
      'tasksByOrganization',
      'failedTasks'
    ]
  },
  filters: {
    employeeId: { type: String },
    startDate: { type: Date },
    endDate: { type: Date },
    importance: { type: String },
    subImportance: { type: String },
    associationId: { type: String },
    status: { type: String}, // יכול להיות array או string
    reasonId: { type: String },
  },
  lastUsed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// אינדקס ייחודי לכל משתמש ומסך
userFilterSchema.index({ userId: 1, screenType: 1 }, { unique: true });

export default mongoose.model('UserFilter', userFilterSchema);