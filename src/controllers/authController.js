import User from '../models/User.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

// רישום משתמש
export const register = async (req, res) => {
  
    const { userName, password, firstName, lastName, role, email } = req.body;

    const existingUser = await User.findOne({ userName });
    if (existingUser) {
        res.status(400);
        throw new Error('שם המשתמש כבר קיים');
    }

    // הצפנת סיסמה
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      userName,
      password: hashedPassword,
      firstName,
      lastName,
      role,
      email
    });

    return res.status(201).json({
         message: "העובד נוסף בהצלחה",
         User:newUser});
};

export const login = async (req, res) => {
  
    const { userName, password } = req.body;

    const user = await User.findOne({ userName }).select('+password +role');

    if (!user) {
        res.status(400);
        throw new Error('שם משתמש או סיסמה שגויים');
    }

    // השוואת סיסמאות
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        res.status(400);
        throw new Error('שם משתמש או סיסמה שגויים');
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    return res.status(200).json({
      message: 'התחברת בהצלחה',
      token,
      user: {
        id: user._id,
        userName: user.userName,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      }
    
    });
};
