import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    userName: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        unique: true,
        match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
    },
    password: {
        type: String,
        required: true,
        minlength: 6,
        select: false,
        trim: true
    },
    firstName: {
        type: String,
        required: true,
        trim: true
    },
    lastName: {
        type: String,
        required: true,
        trim: true
    },
    role: {
        type: String,
        enum: ['מנהל', 'עובד'],
        required: true
    },
    resetToken: {
        type: String,
        default: null 
    },
    resetTokenExpiry: {
        type: Date, 
        default: null
    },
    //עובד יכול להיות מקושר לכמה עמותות
    associations: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Association',
        required: function () {
            return this.role === 'worker'; // רק לעובדים חובה עמותה
        }
    }]


}, { timestamps: true });

const User = mongoose.model('User', userSchema);
export default User;
