import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema({
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: [
      'משימת מגירה לא עודכנה 14 ימים',
      'עבר המועד',
      'לא עודכן ע"י אחד האחראים',
      'משימה חד"פ לא הושלמה 30 ימים'
    ],
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  resolved: {
    type: Boolean,
    default: false,
  },
  details: {
    type: String,
  },
});

const Alert = mongoose.model('Alert', alertSchema);
export default Alert;
