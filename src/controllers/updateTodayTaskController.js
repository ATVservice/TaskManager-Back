import RecurringTask from "../models/RecurringTask.js";

export const completeRecurringTask = async (req, res) => {
  const { taskId } = req.params;
  console.log("#####taskId", taskId);
  const { status, content } = req.body;
  console.log("#####status", status);
  console.log("#####content", content);

  const userId = req.user._id;
  const recurring = await RecurringTask.findById(taskId);

  if (!recurring) return res.status(404).json({ message: "משימה קבועה לא נמצאה" });

  if (!recurring.project || recurring.project === "") {
    recurring.project = null;
  }

  recurring.notes.push({
    date: new Date(),
    user: userId,
    status,
    content
  });


  await recurring.save();
  res.json({ message: "עודכן בהצלחה", recurring });
};
