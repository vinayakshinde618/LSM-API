'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class menu_access_masters extends Model {
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
      this.belongsTo(models.menu_masters, { foreignKey: 'menu_id', as: 'menu_masters' });
      this.belongsTo(models.role_masters, { foreignKey: 'role_id', as: 'role_masters' });
    }
  }
  menu_access_masters.init({
    tenant_id: DataTypes.INTEGER,
    role_id: DataTypes.INTEGER,
    menu_id: DataTypes.INTEGER,
    access: DataTypes.BOOLEAN,
    is_active: DataTypes.BOOLEAN,
    created_by: DataTypes.INTEGER,
    updated_by: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'menu_access_masters',
  });
  return menu_access_masters;
};