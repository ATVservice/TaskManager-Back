import User from "../models/User.js";
import bcrypt from "bcrypt";

export const validatePassword = async (userId, password) => {
    if (!password) return false;
    const user = await User.findById(userId).select('+password');
    if (!user || !user.password) return false;
    return bcrypt.compare(password, user.password);

}
export default validatePassword;