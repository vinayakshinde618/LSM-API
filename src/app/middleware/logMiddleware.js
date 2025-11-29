const winston = require('winston');
const moment = require('moment-timezone');
require('winston-daily-rotate-file'); // Import log rotation package

const logRotationTransport = new winston.transports.DailyRotateFile({
  filename: 'logs/combined-%DATE%.log',
  datePattern: 'YYYY-MM-DD', // Rotates logs daily
  maxSize: '50m',            // Maximum log file size (e.g., 10MB)
  maxFiles: '14d',           // Keep logs for the last 14 days
  zippedArchive: true        // Compress old log files to save space
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      const istTimestamp = moment(timestamp).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');
      return `${istTimestamp} [${level.toUpperCase()}] ${JSON.stringify(message)}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    logRotationTransport // Added rotating log transport
  ]
});

const logMiddleware = (req, res, next) => {
  const start = Date.now();

  const oldSend = res.send;
  res.send = function (data) {
    const duration = Date.now() - start;

    logger.info({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      payload: req.body,
      response: JSON.parse(JSON.stringify(data))
    });

    oldSend.apply(res, arguments);
  };

  res.on('error', (err) => {
    logger.error({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      error: err.message,
      payload: req.body,
      response: res.locals?.responseData || 'No response data'
    });
  });

  next();
};

module.exports = logMiddleware;
