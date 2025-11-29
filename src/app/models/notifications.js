'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class notifications extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      this.belongsTo(models.tenants, { foreignKey: 'tenant_id', as: 'tenants' });
      this.belongsTo(models.user_masters, { foreignKey: 'created_by', as: 'user_masters_create' });
      this.belongsTo(models.user_masters, { foreignKey: 'updated_by', as: 'user_masters_update' });
      this.belongsTo(models.student_masters, { foreignKey: 'student_id', as: 'student_masters' });
    }
  }
  notifications.init({
    tenant_id: DataTypes.INTEGER,
    student_id: DataTypes.INTEGER,
    type: DataTypes.INTEGER,
    title: DataTypes.STRING,
    message: DataTypes.STRING,
    status: DataTypes.INTEGER,
    is_active: DataTypes.BOOLEAN,
    created_by: DataTypes.INTEGER,
    updated_by: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'notifications',
  });
  return notifications;
};