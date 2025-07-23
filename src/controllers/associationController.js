import Association from "../models/Association.js";
import mongoose from "mongoose";
import User from "../models/User.js";
export const createAssociation = async (req, res) => {
    const { name, description } = req.body;

    const existingName = await Association.findOne({ name });
    if (existingName) {
        res.status(400);
        throw new Error('עמותה זו כבר קיימת');
    }
    const newAssociation = await Association.create({
        name,
        description
    });

    return res.status(201).json({
        message: 'העמותה נוספה בהצלחה',
        association: newAssociation
    });
}

export const getAllAssociations = async (req, res) => {
    const associations = await Association.find();
    return res.status(200).json(associations);

};
// מחזירה לכל עמותה את העובדים שלה
export const getAssociatedEmployees = async (req, res) => {
    const { associationId } = req.params;
    console.log('associationId:', associationId);

    if (!mongoose.Types.ObjectId.isValid(associationId)) {
        res.status(400);
        throw new Error('קוד עמותה לא תקין');
    }
    const association = await Association.findById(associationId).populate('workers');
    if (!association) {
        res.status(404);
        throw new Error('עמותה לא נמצאה');
    }
    return res.status(200).json(association.workers);

}
// שיוך עובדים לעמותה
export const addAssociationToUsers = async (req, res) => {
  
    const { userIds, associationId } = req.body;

    if (!Array.isArray(userIds) || !mongoose.Types.ObjectId.isValid(associationId)) {
        res.status(400);
        throw new Error('נתונים לא תקינים');
    }

    // עדכון מרובה - מוסיף את קוד העמותה רק אם הוא לא כבר קיים
    const result = await User.updateMany(
      { _id: { $in: userIds.map(id => new mongoose.Types.ObjectId(id)) } },
      { $addToSet: { associations: associationId } }
    );

    res.json({
      message: `העמותה נוספה ל-${result.modifiedCount} עובדים`,
      matchedCount: result.matchedCount
    });
};


