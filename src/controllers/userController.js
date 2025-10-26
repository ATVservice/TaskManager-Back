import RecurringTask from "../models/RecurringTask.js";
import Task from "../models/Task.js";
import User from "../models/User.js";
import bcrypt from 'bcrypt';

export const getAllEmployees = async (req, res) => {
  const employees = await User.find();
  return res.status(200).json(employees);
};

export const updateUser = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  if (updates.password) {
    updates.password = await bcrypt.hash(updates.password, 10);
  }

  const updatedUser = await User.findByIdAndUpdate(
    id,
    updates,
    {
      new: true, 
      runValidators: true,
    }
  )
  if (!updatedUser) {
    res.status(404);
    throw new Error('משתמש לא נמצא');
  }
  res.status(200).json(updatedUser);

};

export const deleteUser = async (req, res) => {
  const { id } = req.params;

    const existingRecurringTask = await RecurringTask.findOne({
      $or: [
        { creator: id },
        { mainAssignee: id },
        { assignees: id }
      ],
    });

    if (existingRecurringTask) {
      res.status(404);
      throw new Error("לא ניתן למחוק את המשתמש – הוא מקושר למשימות פעילות")
    }

    const existingTask = await Task.findOne({
      $or: [
        { creator: id },
        { mainAssignee: id },
        { assignees: id }
      ],
    });

    if (existingTask) {
      res.status(404);
      throw new Error("לא ניתן למחוק את המשתמש – הוא מקושר למשימות פעילות")
    }

    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
      res.status(404);
      throw new Error("משתמש לא נמצא")
    }

    res.status(200).json({ message: "המשתמש נמחק בהצלחה" });
  
};


export const getUserNamesEmployees = async (req, res) => {
  try {
    const employees = await User.find().select('userName _id');
    // const names = employees.map(emp => emp.userName);
    return res.status(200).json(employees);
  } catch (error) {
    return res.status(500).json({ error: 'שגיאה בעת שליפת העובדים' });
  }
};
export const getNamesEmployees = async (req, res) => {
  try {
    const employees = await User.find().select('userName firstName lastName _id');
    return res.status(200).json(employees);
  } catch (error) {
    return res.status(500).json({ error: 'שגיאה בעת שליפת העובדים' });
  }
};


