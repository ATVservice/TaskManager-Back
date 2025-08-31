export const saveUserFilter = async (userId, screenType, filters) => {
    try {
      // ניקוי פילטרים ריקים
      const cleanFilters = cleanEmptyFilters(filters);
      
      // עדכון או יצירה חדשה
      const result = await UserFilter.findOneAndUpdate(
        { userId, screenType },
        { 
          filters: cleanFilters,
          lastUsed: new Date()
        },
        { 
          upsert: true, 
          new: true,
          runValidators: true
        }
      );
  
      console.log(`Filter saved for user ${userId}, screen: ${screenType}`, cleanFilters);
      return result;
    } catch (error) {
      console.error('Error saving user filter:', error);
      throw error;
    }
  };
  
  /**
   * טעינת פילטר שמור למשתמש
   */
  export const loadUserFilter = async (userId, screenType) => {
    try {
      const userFilter = await UserFilter.findOne({ userId, screenType });
      
      if (!userFilter) {
        return {};
      }
  
      // עדכון זמן שימוש אחרון
      await UserFilter.findByIdAndUpdate(userFilter._id, { 
        lastUsed: new Date() 
      });
  
      return userFilter.filters || {};
    } catch (error) {
      console.error('Error loading user filter:', error);
      return {};
    }
  };
  
  /**
   * איפוס פילטר למשתמש
   */
  export const resetUserFilter = async (userId, screenType) => {
    try {
      await UserFilter.findOneAndDelete({ userId, screenType });
      console.log(`Filter reset for user ${userId}, screen: ${screenType}`);
      return true;
    } catch (error) {
      console.error('Error resetting user filter:', error);
      throw error;
    }
  };
  
  /**
   * קבלת כל הפילטרים של משתמש
   */
  export const getUserAllFilters = async (userId) => {
    try {
      const filters = await UserFilter.find({ userId }).sort({ lastUsed: -1 });
      return filters;
    } catch (error) {
      console.error('Error getting user filters:', error);
      return [];
    }
  };
  
  /**
   * ניקוי פילטרים ריקים
   */
  const cleanEmptyFilters = (filters) => {
    const cleaned = {};
    
    Object.keys(filters).forEach(key => {
      const value = filters[key];
      
      // לא שומרים ערכים ריקים
      if (value !== null && value !== undefined && value !== '' && value !== 'all') {
        // אם זה array, נשמור רק אם יש בו ערכים
        if (Array.isArray(value)) {
          if (value.length > 0) {
            cleaned[key] = value;
          }
        } else {
          cleaned[key] = value;
        }
      }
    });
    
    return cleaned;
  };