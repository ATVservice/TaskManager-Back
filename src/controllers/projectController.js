import Project from "../models/Project.js";

// הוספת פרויקט חדש
export const addProject = async (req, res) => {
    const { name, isActive } = req.body;

    if (!name) {
        res.status(400);
        throw new Error("חסר שם פרויקט");
    }
    const project = new Project({ name, isActive });
    await project.save();

    res.status(201).json({ message: "פרויקט נוסף בהצלחה", project });
};

// שליפת כל שמות הפרויקטים
export const getAllProjectNames = async (req, res) => {
    const projects = await Project.find({ isActive: true });
    res.json(projects);
};
