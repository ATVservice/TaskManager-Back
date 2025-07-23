export const requireAdmin = (req, res, next) => {
    console.log("!!!!",req.user)
    if (req.user.role !== 'מנהל') {
      return res.status(403).json({ message: 'אין לך הרשאה לבצע פעולה זו' });
    }
    next();
  };
  