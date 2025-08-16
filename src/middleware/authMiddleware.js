import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;

const lastActivityMap = {};

export const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'אין הרשאה - לא נשלח טוקן' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'המשתמש לא קיים יותר במערכת' });
    }


    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'טוקן שגוי או שפג תוקפו' });
  }
};
