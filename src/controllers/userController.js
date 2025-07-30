import User from "../models/User.js";

export const getAllEmployees = async (req, res) => {
    const employees = await User.find({ role: 'עובד' });
    return res.status(200).json(employees);
};

export const updateUser = async (req, res) => {
    const { id } = req.params;
    const updates = req.body;


    const updatedUser = await User.findByIdAndUpdate(
        id,
        updates,
        {
            new: true, // מחזיר את המסמך לאחר העדכון
            runValidators: true,
        }
    )
    if (!updatedUser) {
        res.status(404);
        throw new Error('משתמש לא נמצא');
    }
    res.status(200).json(updatedUser);

};

  export const getUserNamesEmployees = async (req, res) => {
    try {
      const employees = await User.find({ role: 'עובד' }).select('userName _id');
      // const names = employees.map(emp => emp.userName);
      return res.status(200).json(employees);
    } catch (error) {
      return res.status(500).json({ error: 'שגיאה בעת שליפת העובדים' });
    }
  };
  
  
