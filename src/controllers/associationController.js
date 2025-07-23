import Association from "../models/Association.js";

export const createAssociation = async (req, res) => {
    const { name, description } = req.body;

    const existingName  = await Association.findOne({name});
    if (existingName ) {
        return res.status(400).json({ message: 'Association with this name already exists' });
    }
    const newAssociation = await Association.create({
        name,
        description
    });

    return res.status(201).json({
        message: 'Association created successfully',
        association: newAssociation
    });
}

export const getAllAssociations = async (req, res) => {
      const associations = await Association.find();
      return res.status(200).json(associations);
    
  };
