'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const process = require('process');
const basename = path.basename(__filename);
require('dotenv').config();
// const env = process.env.ENV ||'dev';
const env = 'prod';
const config = require(path.join(__dirname, '..', 'config', 'config-sample.json'))[env];
const db = {};

let sequelize;
// config.logging = true; // Disable query logging globally
if (config.use_env_variable) {
  sequelize = new Sequelize(process.env[config.use_env_variable], {
    ...config,
    attributeBehavior: "escape", // Add this line
  });
} else {
  sequelize = new Sequelize(config.database, config.username, config.password, {
    ...config,
    attributeBehavior: "escape", // Add this line
  });
}


fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

// here write an for loop, going thorugh each model and assigining the schema

module.exports = db;
