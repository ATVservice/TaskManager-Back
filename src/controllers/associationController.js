import Association from "../models/Association.js";

export const createAssociation = async (req, res) => {
    const { name, description } = req.body;

    const existingName  = await Association.findOne({name});
    if (existingName ) {
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
