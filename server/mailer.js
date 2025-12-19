const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'rityasinha@gmail.com',
        pass: 'oktyrknykcwtxjeq'
    }
});

module.exports = transporter;