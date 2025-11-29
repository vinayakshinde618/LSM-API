'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class term_and_condition_masters extends Model {
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
    }
  }
  term_and_condition_masters.init({
    tenant_id: DataTypes.INTEGER,
    title: DataTypes.STRING,
    description: DataTypes.TEXT,
    is_active: DataTypes.BOOLEAN,
    created_by: DataTypes.INTEGER,
    updated_by: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'term_and_condition_masters',
  });
  return term_and_condition_masters;
};