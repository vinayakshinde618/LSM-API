const http = require('http');
const app = require('./src/app');
const Model = require('./src/app/models');
require('dotenv').config();

const server = http.createServer(app);
const env = process.env.ENV || 'dev';
const config = require('./src/app/config/config.json')[env];
const PORT = config.PORT;

// server.listen(PORT, () => {
//   console.warn(`Academics and content is running on port ${PORT}.`);
// });

// Test the database connection
Model.sequelize
  .authenticate()
  .then(() => {
    console.log(config);
    console.log(`"${env}" database connection established successfully!`);

    // Sync the models with the database
    // return Model.sequelize.sync({ alter: true }); // Use `force: true` for dropping tables and recreating them
  })
  .then(() => {
    // Start the server
    app.listen(PORT, () => {
      console.warn(`Server is running on --->  http://localhost:${PORT}/api/`);
    });
  })
  .catch((err) => {
    console.error('Unable to connect to the database:', err);
  });
