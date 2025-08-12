import nodemailer from "nodemailer";

export default async function sendEmail(to, subject, content, isHtml = false) {
    const transporter = nodemailer.createTransport({
        service: "Gmail",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to,
        subject
    };

    if (isHtml) {
        mailOptions.html = content;
    } else {
        mailOptions.text = content;
    }

    await transporter.sendMail(mailOptions);

}
