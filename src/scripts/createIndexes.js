import mongoose from 'mongoose';
import Task from '../models/Task.js'; 
import RecurringTask from '../models/RecurringTask.js';
import TaskAssigneeDetails from '../models/TaskAssigneeDetails.js';
import Goal from '../models/Goal.js';
import User from '../models/User.js';
import dotenv from 'dotenv';

dotenv.config();


const connectDB = async () => {
    try {
        await mongoose.connect(process.env.LOCAL_URI); 
        console.log('מחובר למסד נתונים');
    } catch (error) {
        console.error('שגיאה בחיבור למסד נתונים:', error);
        process.exit(1);
    }
};

const createIndexes = async () => {
    try {
        console.log('יוצר אינדקסים...');

        // אינדקסים למשימות רגילות
        await Task.collection.createIndex({ 
            "isDeleted": 1, 
            "status": 1, 
            "updatedAt": 1 
        });
        console.log('✅ אינדקס למשימות רגילות - סטטוס ותאריך');

        await Task.collection.createIndex({ 
            "assignees": 1, 
            "updatedAt": 1 
        });
        console.log('✅ אינדקס למשימות רגילות - אחראים ותאריך');

        await Task.collection.createIndex({ 
            "isDeleted": 1, 
            "importance": 1 
        });
        console.log('✅ אינדקס למשימות רגילות - חשיבות');

        // אינדקסים למשימות קבועות
        await RecurringTask.collection.createIndex({ 
            "isDeleted": 1 
        });
        console.log('✅ אינדקס למשימות קבועות - מחיקה');

        await RecurringTask.collection.createIndex({ 
            "notes.date": 1, 
            "notes.status": 1 
        });
        console.log('✅ אינדקס למשימות קבועות - הערות');

        await RecurringTask.collection.createIndex({ 
            "isDeleted": 1, 
            "importance": 1 
        });
        console.log('✅ אינדקס למשימות קבועות - חשיבות');

        // אינדקסים ל-TaskAssigneeDetails
        await TaskAssigneeDetails.collection.createIndex({ 
            "status": 1, 
            "updatedAt": 1 
        });
        console.log('✅ אינדקס ל-TaskAssigneeDetails - סטטוס ותאריך');

        await TaskAssigneeDetails.collection.createIndex({ 
            "user": 1, 
            "status": 1 
        });
        console.log('✅ אינדקס ל-TaskAssigneeDetails - משתמש וסטטוס');

        await TaskAssigneeDetails.collection.createIndex({ 
            "taskId": 1 
        });
        console.log('✅ אינדקס ל-TaskAssigneeDetails - מזהה משימה');

        // אינדקסים ליעדים
        await Goal.collection.createIndex({ 
            "targetType": 1 
        });
        console.log('✅ אינדקס ליעדים - סוג יעד');

        await Goal.collection.createIndex({ 
            "targetType": 1, 
            "importance": 1 
        });
        console.log('✅ אינדקס ליעדים - סוג יעד וחשיבות');

        await Goal.collection.createIndex({ 
            "employee": 1 
        });
        console.log('✅ אינדקס ליעדים - עובד');

        // אינדקסים למשתמשים
        await User.collection.createIndex({ 
            "role": 1 
        });
        console.log('✅ אינדקס למשתמשים - תפקיד');

        console.log('🎉 כל האינדקסים נוצרו בהצלחה!');
        
        // הצג רשימה של כל האינדקסים
        console.log('\n📋 רשימת אינדקסים שנוצרו:');
        const taskIndexes = await Task.collection.indexes();
        console.log('Tasks:', taskIndexes.map(i => i.name).join(', '));

        const recurringIndexes = await RecurringTask.collection.indexes();
        console.log('RecurringTasks:', recurringIndexes.map(i => i.name).join(', '));

        const detailsIndexes = await TaskAssigneeDetails.collection.indexes();
        console.log('TaskAssigneeDetails:', detailsIndexes.map(i => i.name).join(', '));

        const goalIndexes = await Goal.collection.indexes();
        console.log('Goals:', goalIndexes.map(i => i.name).join(', '));

        const userIndexes = await User.collection.indexes();
        console.log('Users:', userIndexes.map(i => i.name).join(', '));

    } catch (error) {
        console.error('שגיאה ביצירת אינדקסים:', error);
    } finally {
        await mongoose.connection.close();
        console.log('חיבור למסד נתונים נסגר');
        process.exit(0);
    }
};

// הרץ את הסקריפט
const main = async () => {
    await connectDB();
    await createIndexes();
};

main();