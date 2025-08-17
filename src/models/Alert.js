import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema({
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
  },
  type: {
    type: String,
    required: true,
    enum: [
      'משימת מגירה שהקמת לא עודכנה 14 ימים',
      'משימת מגירה שבאחריותך לא עודכנה 14 ימים',
      'משימת מגירה לא עודכנה 14 ימים',
      'עבר המועד',
      'לא עודכן ע"י אחד האחראים',
      'משימה חד"פ לא הושלמה 30 ימים',
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
