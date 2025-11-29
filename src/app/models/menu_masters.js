'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class menu_masters extends Model {
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
      this.hasMany(models.menu_masters, { foreignKey: 'parent_id', as: 'childMenus', });
      this.belongsTo(models.menu_masters, { foreignKey: 'parent_id', as: 'parentMenu', });
    }
  }
  menu_masters.init({
    tenant_id: DataTypes.INTEGER,
    menu_name: DataTypes.STRING,
    menu_url: DataTypes.STRING,
    menu_icon: DataTypes.STRING,
    is_child: DataTypes.BOOLEAN,
    parent_id: DataTypes.INTEGER,
    sequence: DataTypes.INTEGER,
    is_active: DataTypes.BOOLEAN,
    created_by: DataTypes.INTEGER,
    updated_by: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'menu_masters',
  });
  return menu_masters;
};