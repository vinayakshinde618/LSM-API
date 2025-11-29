'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class user_masters extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      this.belongsTo(models.tenants, { foreignKey: 'tenant_id', as: 'tenants' });
      this.belongsTo(models.role_masters, { foreignKey: 'role_id', as: 'role_masters' });
      this.belongsTo(models.user_masters, { foreignKey: 'created_by', as: 'user_masters_create' });
      this.belongsTo(models.user_masters, { foreignKey: 'updated_by', as: 'user_masters_update' });
    }
  }
  user_masters.init({
    tenant_id: DataTypes.INTEGER,
    role_id: DataTypes.INTEGER,
    name: DataTypes.STRING,
    email_id: DataTypes.STRING,
    username: DataTypes.STRING,
    password: DataTypes.STRING,
    mobile_number: DataTypes.BIGINT,
    is_active: DataTypes.BOOLEAN,
    created_by: DataTypes.INTEGER,
    updated_by: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'user_masters',
  });
  return user_masters;
};