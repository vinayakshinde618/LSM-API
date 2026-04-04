const http = require('http');
const app = require('./src/app');
const Model = require('./src/app/models');
require('dotenv').config();

const server = http.createServer(app);
// const env = process.env.ENV || 'dev';
const env = 'prod';
const config = require('./src/app/config/config-sample.json')[env];
const PORT = process.env.PORT || 1000;

server.listen(PORT, () => {
  console.warn(`LMS is running on port ${PORT}.`);
});