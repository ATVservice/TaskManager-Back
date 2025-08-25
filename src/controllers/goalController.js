import Goal from "../models/Goal.js";

export const createGoal = async (req, res) => {

  let { targetType, employee, importance, subImportance, frequency, targetCount } = req.body.formData;
  targetCount = Number(targetCount);
  console.log("req.body.formData", req.body.formData)
  console.log("targetCount", targetCount)



  if (!targetType || !frequency || !targetCount) {
    res.status(400);
    throw new Error("חסרים שדות חובה")
  }

  if (targetCount <= 0) {
    res.status(400);
    throw new Error("יעד צריך להיות גדול מ-0")
  }

  const existingGoal = await Goal.findOne({
    targetType,
    employee: employee || null,
    importance,
    subImportance: subImportance || null,
    frequency
  });

  if (existingGoal) {
    existingGoal.targetCount = targetCount;
    await existingGoal.save();
    return res.status(200).json(existingGoal);
  } else {
    const goal = await Goal.create({
      ...req.body.formData,
      createdBy: req.user._id
    });
    return res.status(201).json(goal);
  }

};
// שליפה לפי עובד ומיון לפי סוג משימה
export const getGoalsByEmployee = async (req, res) => {
    const { employeeId } = req.params;

    if (!employeeId) {
      res.status(400);
      throw new Error("חסר מזהה עובד")
    }

    // שליפה ומיון
    const goals = await Goal.find({
      $or: [
        { targetType: 'כלל העובדים' },
        { targetType: 'עובד בודד', employee: employeeId }
      ]
    }).sort({ importance: 1 });

    return res.status(200).json(goals);
   
};
