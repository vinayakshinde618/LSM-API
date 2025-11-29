'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class seat_bookings extends Model {
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
      this.belongsTo(models.student_masters, { foreignKey: 'student_id', as: 'student_masters' });
      this.belongsTo(models.seat_masters, { foreignKey: 'seat_id', as: 'seat_masters' });
      this.belongsTo(models.seat_slot_masters, { foreignKey: 'slot_id', as: 'seat_slot_masters' });
      this.belongsTo(models.payment_plans, { foreignKey: 'plan_id', as: 'payment_plans' });
      this.belongsTo(models.user_masters, { foreignKey: 'created_by', as: 'user_masters_create' });
      this.belongsTo(models.user_masters, { foreignKey: 'updated_by', as: 'user_masters_update' });
    }
  }
  seat_bookings.init({
    tenant_id: DataTypes.INTEGER,
    branch_id: DataTypes.INTEGER,
    floor_id: DataTypes.INTEGER,
    student_id: DataTypes.INTEGER,
    seat_id: DataTypes.INTEGER,
    slot_id: DataTypes.INTEGER,
    plan_id: DataTypes.INTEGER,
    start_date: DataTypes.DATE,
    end_date: DataTypes.DATE,
    status: DataTypes.INTEGER,
    is_active: DataTypes.BOOLEAN,
    created_by: DataTypes.INTEGER,
    updated_by: DataTypes.INTEGER
  }, {
    sequelize,
    modelName: 'seat_bookings',
  });
  return seat_bookings;
};