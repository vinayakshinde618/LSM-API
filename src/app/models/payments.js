'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class payments extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      this.belongsTo(models.seat_bookings, { foreignKey: 'booking_id', as: 'seat_bookings' });
      this.belongsTo(models.student_masters, { foreignKey: 'student_id', as: 'student_masters' });
    }
  }
  payments.init({
    booking_id: DataTypes.INTEGER,
    student_id: DataTypes.INTEGER,
    amount: DataTypes.FLOAT,
    mode: DataTypes.INTEGER,
    transaction_id: DataTypes.STRING,
    is_active: DataTypes.BOOLEAN
  }, {
    sequelize,
    modelName: 'payments',
  });
  return payments;
};