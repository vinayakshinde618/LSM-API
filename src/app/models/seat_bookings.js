'use strict';
const { Model, Op } = require('sequelize');

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

  // ─── Helper: date overlap check ──────────────────────────────────────────────
  // Two ranges overlap if: newStart <= existingEnd AND newEnd >= existingStart
  const dateOverlapWhere = (startDate, endDate, excludeId = null) => {
    const where = {
      start_date: { [Op.lte]: endDate },
      end_date:   { [Op.gte]: startDate },
      status:     { [Op.ne]: 2 },   // 2 = cancelled
      is_active:  true,
    };
    if (excludeId) where.id = { [Op.ne]: excludeId };
    return where;
  };

  // ─── beforeCreate hook ────────────────────────────────────────────────────────
  seat_bookings.beforeCreate(async (booking) => {
    const models = sequelize.models;

    // 1. Required fields
    const required = ['tenant_id', 'branch_id', 'floor_id', 'student_id', 'seat_id', 'plan_id', 'start_date', 'end_date'];
    for (const field of required) {
      if (booking[field] === null || booking[field] === undefined) {
        throw new Error(`${field.replace(/_/g, ' ')} is required.`);
      }
    }

    // 2. start_date must not be in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(booking.start_date);
    startDate.setHours(0, 0, 0, 0);
    if (startDate < today) {
      throw new Error('Start date cannot be in the past.');
    }

    // 3. end_date must be after start_date
    if (new Date(booking.end_date) <= new Date(booking.start_date)) {
      throw new Error('End date must be after start date.');
    }

    // 4. Student must exist and be active
    const student = await models.student_masters.findOne({
      where: { id: booking.student_id, tenant_id: booking.tenant_id, is_active: true },
    });
    if (!student) {
      throw new Error('Student not found or is inactive. Please register the student first.');
    }

    // 5. Seat must exist, be active, and belong to the specified branch & floor
    const seat = await models.seat_masters.findOne({
      where: {
        id:        booking.seat_id,
        tenant_id: booking.tenant_id,
        branch_id: booking.branch_id,
        floor_id:  booking.floor_id,
        is_active: true,
      },
    });
    if (!seat) {
      throw new Error('Seat not found or does not belong to the selected branch/floor, or is inactive.');
    }

    // 6. Slot must exist and be active
    // const slot = await models.seat_slot_masters.findOne({
    //   where: { id: booking.slot_id, tenant_id: booking.tenant_id, is_active: true },
    // });
    // if (!slot) {
    //   throw new Error('Seat slot not found or is inactive.');
    // }

    // 7. Payment plan must exist and be active
    const plan = await models.payment_plans.findOne({
      where: { id: booking.plan_id, tenant_id: booking.tenant_id, is_active: true },
    });
    if (!plan) {
      throw new Error('Payment plan not found or is inactive.');
    }

    // 8. Student must not already have an active booking within the date range
    //    (regardless of seat — a student can only have one active booking at a time)
    const studentActiveBooking = await models.seat_bookings.findOne({
      where: {
        student_id: booking.student_id,
        tenant_id:  booking.tenant_id,
        ...dateOverlapWhere(booking.start_date, booking.end_date),
      },
    });
    if (studentActiveBooking) {
      const endDate = new Date(studentActiveBooking.end_date).toLocaleDateString('en-IN');
      throw new Error(
        `This student already has an active seat booking valid until ${endDate}. ` +
        `A new booking can only be created after the current booking expires.`
      );
    }

    // 9. Same seat + same slot must not already be booked for overlapping dates
    const seatSlotConflict = await models.seat_bookings.findOne({
      where: {
        seat_id:   booking.seat_id,
        slot_id:   booking.slot_id || null,
        tenant_id: booking.tenant_id,
        ...dateOverlapWhere(booking.start_date, booking.end_date),
      },
    });
    if (seatSlotConflict) {
      const endDate = new Date(seatSlotConflict.end_date).toLocaleDateString('en-IN');
      throw new Error(
        `This seat is already booked for the selected slot until ${endDate}. ` +
        `Please choose a different seat or slot.`
      );
    }
  });

  // ─── beforeUpdate hook ────────────────────────────────────────────────────────
  seat_bookings.beforeUpdate(async (booking) => {
    const models = sequelize.models;
    const changed = booking.changed(); // list of changed field names

    const startDate = new Date(booking.start_date);
    const endDate   = new Date(booking.end_date);

    // 1. Date validations (only when dates change)
    if (changed.includes('start_date') || changed.includes('end_date')) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const start = new Date(booking.start_date);
      start.setHours(0, 0, 0, 0);

      if (start < today) {
        throw new Error('Start date cannot be in the past.');
      }
      if (endDate <= startDate) {
        throw new Error('End date must be after start date.');
      }
    }

    // 2. Seat still valid for the branch/floor (if seat, branch, or floor changes)
    if (changed.includes('seat_id') || changed.includes('branch_id') || changed.includes('floor_id')) {
      const seat = await models.seat_masters.findOne({
        where: {
          id:        booking.seat_id,
          tenant_id: booking.tenant_id,
          branch_id: booking.branch_id,
          floor_id:  booking.floor_id,
          is_active: true,
        },
      });
      if (!seat) {
        throw new Error('Seat not found or does not belong to the selected branch/floor, or is inactive.');
      }
    }

    // 3. Slot still active (if slot changes)
    if (changed.includes('slot_id')) {
      const slot = await models.seat_slot_masters.findOne({
        where: { id: booking.slot_id, tenant_id: booking.tenant_id, is_active: true },
      });
      if (!slot) {
        throw new Error('Seat slot not found or is inactive.');
      }
    }

    // 4. Payment plan still active (if plan changes)
    if (changed.includes('plan_id')) {
      const plan = await models.payment_plans.findOne({
        where: { id: booking.plan_id, tenant_id: booking.tenant_id, is_active: true },
      });
      if (!plan) {
        throw new Error('Payment plan not found or is inactive.');
      }
    }

    // 5. Duplicate student booking check (when student, seat, slot, or dates change)
    const bookingFieldsChanged = ['student_id', 'seat_id', 'slot_id', 'start_date', 'end_date'].some(f => changed.includes(f));
    if (bookingFieldsChanged) {
      // 5a. Student must not already have another active booking in the same date range
      const studentConflict = await models.seat_bookings.findOne({
        where: {
          student_id: booking.student_id,
          tenant_id:  booking.tenant_id,
          ...dateOverlapWhere(booking.start_date, booking.end_date, booking.id),
        },
      });
      if (studentConflict) {
        const expiry = new Date(studentConflict.end_date).toLocaleDateString('en-IN');
        throw new Error(
          `This student already has an active seat booking valid until ${expiry}. ` +
          `A new booking can only be created after the current booking expires.`
        );
      }

      // 5b. Same seat + slot must not already be taken by another booking
      const seatSlotConflict = await models.seat_bookings.findOne({
        where: {
          seat_id:   booking.seat_id,
          slot_id:   booking.slot_id,
          tenant_id: booking.tenant_id,
          ...dateOverlapWhere(booking.start_date, booking.end_date, booking.id),
        },
      });
      if (seatSlotConflict) {
        const expiry = new Date(seatSlotConflict.end_date).toLocaleDateString('en-IN');
        throw new Error(
          `This seat is already booked for the selected slot until ${expiry}. ` +
          `Please choose a different seat or slot.`
        );
      }
    }
  });

  return seat_bookings;
};
