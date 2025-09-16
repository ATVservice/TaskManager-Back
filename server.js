import app from './src/app.js';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();
  
// התחברות למסד

const URI = process.env.LOCAL_URI 
mongoose.connect(URI)
.then(() => console.log('Connected to MongoDB 😍'))
.catch(err => console.log({ error: err.message }));


// הפעלת השרת
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
