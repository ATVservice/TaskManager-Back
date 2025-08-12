import User from '../models/User.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import crypto from "crypto";
import sendEmail from "../utils/sendEmail.js";
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
    User: newUser
  });
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
    { expiresIn: '15m' }
  );

  return res.status(200).json({
    message: 'התחברת בהצלחה',
    token,
    user: {
      id: user._id,
      userName: user.userName,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role
    }

  });
};
// ריענון טוקן
export const refreshToken = async (oldToken) => {
  try {
    const payload = jwt.verify(oldToken, JWT_SECRET);
    return generateToken(payload.userId);
  } catch {
    return null;
  }
}

//שליחת קישור למי ששכח סיסמא
export const forgotPassword = async (req, res) => {

  const { email } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    res.status(404);
    throw new Error("משתמש לא נמצא")
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetTokenExpiry = Date.now() + 30 * 60 * 1000;

  user.resetToken = resetToken;
  user.resetTokenExpiry = resetTokenExpiry;
  await user.save();

  const resetLink = `http://localhost:3000/reset-password/${resetToken}`;

  const htmlContent = `
  <p>שלום,</p>
  <p> 👇 לאיפוס סיסמא - לחץ על הכפתור הבא</p>
  <p>
    <a href="${resetLink}" 
       style="display:inline-block;padding:10px 20px;
              background-color:#4CAF50;color:#fff;
              text-decoration:none;border-radius:5px;">
      איפוס סיסמה
    </a>
  </p>
  <p>הקישור יהיה תקף ל-30 דקות.</p>
`;

  await sendEmail(
    user.email,
    "איפוס סיסמה",
    htmlContent,
    true 
  );

  res.json({ message: "קישור איפוס נשלח לאימייל" });
}

//איפוס סיסמא

export const resetPassword = async (req, res) => {

  const { token, newPassword } = req.body;
  const user = await User.findOne({ resetToken: token });

  if (!user) {
    res.status(400);
    throw new Error("קישור לא תקין");

  }
  if (Date.now() > user.resetTokenExpiry) {
    res.status(400);
    throw new Error("הקישור פג תוקף")
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;
  user.resetToken = undefined;
  user.resetTokenExpiry = undefined;
  await user.save();

  res.json({ message: "הסיסמה עודכנה בהצלחה" });
}



