'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class seat_masters extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      this.belongsTo(models.tenants, { foreignKey: 'tenant_id', as: 'tenants' });
      this.belongsTo(models.branch_masters, { foreignKey: 'branch_id', as: 'branch_masters' });
      this.belongsTo(models.floor_masters, { foreignKey: 'floor_id', as: 'floor_masters' });
      this.belongsTo(models.user_masters, { foreignKey: 'created_by', as: 'user_masters_create' });
      this.belongsTo(models.user_masters, { foreignKey: 'updated_by', as: 'user_masters_update' });
    }
  }
  seat_masters.init({
    tenant_id: DataTypes.INTEGER,
    branch_id: DataTypes.INTEGER,
    floor_id: DataTypes.INTEGER,
    seat_number: DataTypes.STRING,
    seat_type: DataTypes.STRING,
    is_active: DataTypes.BOOLEAN,
    created_by: DataTypes.INTEGER,
    updated_by: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'seat_masters',
  });
  return seat_masters;
};