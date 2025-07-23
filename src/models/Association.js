const associationSchema = new mongoose.Schema({
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    isActive: {
      type: Boolean,
      default: true
    },
  })
  //בעתיד כשאני ארצה לשלוף את כל העובדים של העמותה
  //צריך לכתוב רק:
  //Association.findById(id).populate('workers')
 // וזה יהיה מקושר וירטואלית
  associationSchema.virtual('workers', {
    ref: 'User',
    localField: '_id',
    foreignField: 'associations' // או 'association' אם זה שדה בודד
  })
  
  associationSchema.set('toObject', { virtuals: true })
  associationSchema.set('toJSON', { virtuals: true })

  const Association = mongoose.model('Association', associationSchema)
  export default Association



  