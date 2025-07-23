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
