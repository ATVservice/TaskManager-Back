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

    if (!mongoose.Types.ObjectId.isValid(associationId)) {
        res.status(400);
        throw new Error('קוד עמותה לא תקין');
    }
    const association = await Association.findById(associationId)
    .populate('workers')
    .lean();
    if (!association) {
        res.status(404);
        throw new Error('עמותה לא נמצאה');
    }
    return res.status(200).json(association.workers);

}
// שיוך עובדים לעמותה
export const updateAssociationUsers = async (req, res) => {
    const { userIds, associationId } = req.body;
  
    if (!Array.isArray(userIds) || !mongoose.Types.ObjectId.isValid(associationId)) {
      res.status(400);
      throw new Error('נתונים לא תקינים');
    }
  
    // 1. הוספה – נוודא שכל המשתמשים שנבחרו אכן משויכים
    await User.updateMany(
      { _id: { $in: userIds } },
      { $addToSet: { associations: associationId } }
    );
  
    // 2. הסרה – כל מי שלא נמצא ברשימת userIds, נוריד לו את השיוך
    await User.updateMany(
      { _id: { $nin: userIds } },
      { $pull: { associations: associationId } }
    );
  
    res.json({
      message: "שיוך עובדים עודכן בהצלחה",
      updatedFor: userIds.length
    });
  };
  


