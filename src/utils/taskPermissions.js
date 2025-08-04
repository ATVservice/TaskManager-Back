export const getTaskPermissionLevel = (task, user) => {
    const isManager = user.role === 'מנהל';
    const isCreator = task.creator?.equals(user._id);
    const isMainAssignee = task.mainAssignee?.equals(user._id);
    const isSubAssignee = task.assignees?.some(id => id.equals(user._id));
  
    if (isManager || isCreator || isMainAssignee) {
      return 'full'; // יכול לערוך הכל
    }
  
    if (isSubAssignee) {
      return 'limited'; // רק סטטוס אישי והערות
    }
  
    return 'none';
  };
  