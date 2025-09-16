import app from './src/app.js';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

// // הרשאות CORS
// app.use(cors({
//     origin: process.env.FRONT_PORT, 
//     credentials: true
//   }));
  
// התחברות למסד
const URI = process.env.LOCAL_URI || 'mongodb+srv://shlomoavoda:shlomo30@cluster0.5y29qn3.mongodb.net/TaskManager?retryWrites=true&w=majority&appName=Cluster0'
mongoose.connect(URI)
.then(() => console.log('Connected to MongoDB 😍'))
.catch(err => console.log({ error: err.message }));


// הפעלת השרת
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
