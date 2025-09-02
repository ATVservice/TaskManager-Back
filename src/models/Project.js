import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema({

  name: { 
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }

}, { timestamps: true });

export default mongoose.model('Project', projectSchema);
