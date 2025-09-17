const errorHandler = (err, req, res, next) => {
    let statusCode = res.statusCode !== 200 ? res.statusCode : 500;
    let message = err.message;

    if (err.code && err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        message = `${field.charAt(0).toUpperCase() + field.slice(1)} כבר קיים במערכת`;
        statusCode = 400;
    }

    res.status(statusCode).json({
        success: false,
        message,
    });
};

export default errorHandler;
