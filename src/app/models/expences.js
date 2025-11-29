'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class expences extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      this.belongsTo(models.tenants, { foreignKey: 'tenant_id', as: 'tenants' });
      this.belongsTo(models.branch_masters, { foreignKey: 'branch_id', as: 'branch_masters' });
      this.belongsTo(models.expense_type_masters, { foreignKey: 'expense_type_id', as: 'expense_type_masters' });
      this.belongsTo(models.user_masters, { foreignKey: 'created_by', as: 'user_masters_create' });
      this.belongsTo(models.user_masters, { foreignKey: 'updated_by', as: 'user_masters_update' });
    }
  }
  expences.init({
    tenant_id: DataTypes.INTEGER,
    branch_id: DataTypes.INTEGER,
    expense_type_id: DataTypes.INTEGER,
    amount: DataTypes.FLOAT,
    bill_photo: DataTypes.TEXT,
    expense_date: DataTypes.DATE,
    is_active: DataTypes.BOOLEAN,
    created_by: DataTypes.INTEGER,
    updated_by: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'expences',
  });
  return expences;
};