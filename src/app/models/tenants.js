'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class tenants extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  tenants.init({
    tenant_name: DataTypes.STRING,
    email_id: DataTypes.STRING,
    phone: DataTypes.STRING,
    logo: DataTypes.STRING,
    address: DataTypes.TEXT,
    is_active: DataTypes.BOOLEAN,
    created_by: DataTypes.INTEGER,
    updated_by: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'tenants',
  });
  return tenants;
};