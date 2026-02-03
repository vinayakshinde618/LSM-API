const Model = require('../../models');
const { Op, fn, col, literal, cast, where } = require("sequelize");

/**
 * @route   GET /api/dashboard/summary/:tenant_id/:branch_id
 * @desc    Get dashboard summary statistics
 */
exports.summary = async (req, res) => {
  try {
    const { tenant_id, branch_id } = req.params;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const next7Days = new Date(today);
    next7Days.setDate(today.getDate() + 7);

    // 1️⃣ Total seats
    const totalSeats = await Model.seat_masters.count({
      where: {
        tenant_id,
        branch_id,
        is_active: true
      }
    });

    // 2️⃣ Active booked seats (bookings that haven't expired)
    const bookedSeats = await Model.seat_bookings.count({
      where: {
        tenant_id,
        branch_id,
        status: 1,
        is_active: true,
        end_date: { [Op.gte]: today }
      }
    });

    // 3️⃣ Expiring soon (next 7 days)
    const expiringSoon = await Model.seat_bookings.count({
      where: {
        tenant_id,
        branch_id,
        status: 1,
        is_active: true,
        end_date: {
          [Op.between]: [today, next7Days]
        }
      }
    });

    // 4️⃣ Ending today
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    
    const endsToday = await Model.seat_bookings.count({
      where: {
        tenant_id,
        branch_id,
        status: 1,
        is_active: true,
        end_date: {
          [Op.between]: [today, todayEnd]
        }
      }
    });

    // 5️⃣ Floor-wise calculation
    const floors = await Model.floor_masters.findAll({
      where: {
        tenant_id,
        branch_id,
        is_active: true
      },
      attributes: ['id', 'floor_name'],
      include: [
        {
          model: Model.seat_masters,
          as: 'seat_masters',
          attributes: ['id'],
          where: { is_active: true },
          required: false,
          include: [
            {
              model: Model.seat_bookings,
              as: 'seat_bookings',
              attributes: ['id'],
              where: {
                status: 1,
                is_active: true,
                end_date: { [Op.gte]: today }
              },
              required: false
            }
          ]
        }
      ]
    });

    const floorStats = floors.map(floor => {
      const seats = floor.seat_masters || [];
      const total = seats.length;
      const booked = seats.filter(
        s => s.seat_bookings && s.seat_bookings.length > 0
      ).length;

      return {
        floor_id: floor.id,
        floor_name: floor.floor_name,
        total_seats: total,
        booked_seats: booked,
        available_seats: total - booked
      };
    });

    return res.json({
      success: true,
      data: {
        total_seats: totalSeats,
        booked_seats: bookedSeats,
        available_seats: totalSeats - bookedSeats,
        expiring_soon: expiringSoon,
        ends_today: endsToday,
        floors: floorStats
      }
    });

  } catch (error) {
    console.error('Dashboard Summary Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard summary',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/dashboard/seats/:tenant_id/:floor_id
 * @desc    Get detailed seat information for a specific floor
 */
exports.seats = async (req, res) => {
  try {
    const { tenant_id, floor_id } = req.params;

    /* ---------------- FLOOR DETAILS ---------------- */
    const floor = await Model.floor_masters.findOne({
      where: {
        id: floor_id,
        tenant_id,
        is_active: true
      },
      attributes: ['id', 'floor_name', 'capacity']
    });

    if (!floor) {
      return res.status(404).json({
        success: false,
        message: 'Floor not found'
      });
    }

    /* ---------------- SEATS WITH STUDENT DETAILS ---------------- */
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const seats = await Model.seat_masters.findAll({
      where: {
        floor_id,
        tenant_id,
        is_active: true
      },
      attributes: ['id', 'seat_number', 'seat_type'],
      include: [
        {
          model: Model.seat_bookings,
          as: 'seat_bookings',
          required: false,
          where: { 
            status: 1,
            is_active: true,
            end_date: { [Op.gte]: today } // Only active bookings
          },
          attributes: ['id', 'student_id', 'plan_id', 'slot_id', 'start_date', 'end_date'],
          include: [
            {
              model: Model.student_masters,
              as: 'student_masters',
              required: false,
              where: { is_active: true },
              attributes: [
                'id',
                'full_name',
                'student_code',
                'mobile_number',
                'email_id',
                'status'
              ]
            },
            {
              model: Model.payment_plans,
              as: 'payment_plans',
              required: false,
              attributes: ['plan_name', 'duration_days', 'amount']
            },
            {
              model: Model.seat_slot_masters,
              as: 'seat_slot_masters',
              required: false,
              attributes: [
                'slot_name',
                'slot_type',
                'start_time',
                'end_time'
              ]
            }
          ]
        }
      ],
      order: [['seat_number', 'ASC']]
    });

    /* ---------------- RESPONSE TRANSFORMATION ---------------- */
    const processedSeats = seats.map(seat => {
      const seatData = seat.toJSON();
      const booking = seatData.seat_bookings?.[0];
      const student = booking?.student_masters;

      let status = 'available';
      let endDate = null;
      let daysRemaining = null;

      // Check if there's an active booking with a student
      if (booking && booking.start_date && booking.end_date && student) {
        // Check if student status is active (handle both numeric and string status)
        const isStudentActive = student.status == 1 || 
                                student.status === 'Active' || 
                                student.status === 'active';

        if (isStudentActive) {
          const todayTime = new Date();
          todayTime.setHours(0, 0, 0, 0);

          const startDate = new Date(booking.start_date);
          endDate = new Date(booking.end_date);
          endDate.setHours(23, 59, 59, 999);

          daysRemaining = Math.ceil((endDate - todayTime) / (1000 * 60 * 60 * 24));

          if (daysRemaining < 0) {
            status = 'expired';
          } else if (daysRemaining === 0) {
            status = 'last'; // Ends today
          } else if (daysRemaining <= 3) {
            status = 'near'; // Expiring soon
          } else {
            status = 'booked';
          }
        }
      }

      return {
        id: seatData.id,
        seat_number: seatData.seat_number,
        seat_type: seatData.seat_type,
        status,
        student: student ? {
          id: student.id,
          full_name: student.full_name,
          student_code: student.student_code,
          mobile_number: student.mobile_number,
          email_id: student.email_id
        } : null,
        subscription: student ? {
          start_date: booking.start_date,
          end_date: booking.end_date,
          days_remaining: daysRemaining,
          plan_name: booking?.payment_plans?.plan_name,
          slot_type: booking?.seat_slot_masters?.slot_type,
          slot_name: booking?.seat_slot_masters?.slot_name,
          slot_time: booking?.seat_slot_masters?.start_time && booking?.seat_slot_masters?.end_time
            ? `${booking.seat_slot_masters.start_time} - ${booking.seat_slot_masters.end_time}`
            : null,
          amount_paid: booking?.payment_plans?.amount
        } : null
      };
    });

    /* ---------------- FINAL RESPONSE ---------------- */
    return res.json({
      success: true,
      data: {
        floor_id: floor.id,
        floor_name: floor.floor_name,
        capacity: floor.capacity,
        seats: processedSeats
      }
    });

  } catch (error) {
    console.error('Dashboard Seats Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch seat details',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/dashboard/floors/:tenant_id
 * @desc    Get all floors for a tenant
 */
exports.floors = async (req, res) => {
  try {
    const { tenant_id } = req.params;

    const floors = await Model.floor_masters.findAll({
      where: {
        tenant_id,
        is_active: true
      },
      attributes: [
        'id',
        'floor_name',
        'capacity',
        'branch_id'
      ],
      order: [['floor_name', 'ASC']]
    });

    return res.json({
      success: true,
      data: floors
    });

  } catch (error) {
    console.error('Dashboard Floors Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch floors',
      error: error.message
    });
  }
};

/**
 * @route   GET /api/dashboard/search/:tenant_id?q=search_query
 * @desc    Search seats by student name, code, or seat number
 */
exports.search = async (req, res) => {
  try {
    const { tenant_id } = req.params;
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    const searchTerm = `%${q}%`;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Search in active bookings
    const results = await Model.seat_bookings.findAll({
      where: {
        tenant_id,
        is_active: true,
        status: 1,
        end_date: { [Op.gte]: today } // Only active bookings
      },
      attributes: ['id', 'student_id', 'seat_id', 'plan_id', 'start_date', 'end_date'],
      include: [
        {
          model: Model.seat_masters,
          as: 'seat_masters',
          required: true,
          where: { 
            is_active: true,
            [Op.or]: [
              { seat_number: { [Op.like]: searchTerm } }
            ]
          },
          attributes: ['id', 'seat_number'],
          include: [
            {
              model: Model.floor_masters,
              as: 'floor_masters',
              required: false,
              attributes: ['floor_name']
            }
          ]
        },
        {
          model: Model.student_masters,
          as: 'student_masters',
          required: true,
          where: {
            is_active: true,
            [Op.or]: [
              { full_name: { [Op.like]: searchTerm } },
              { student_code: { [Op.like]: searchTerm } },
              where(
                cast(col('student.mobile_number'), 'CHAR'),
                { [Op.like]: searchTerm }
              )
            ]
          },
          attributes: ['id', 'full_name', 'student_code', 'mobile_number']
        },
        {
          model: Model.payment_plans,
          as: 'payment_plans',
          required: false,
          attributes: ['plan_name', 'duration_days']
        },
        {
          model: Model.seat_slot_masters,
          as: 'seat_slot_masters',
          required: false,
          attributes: ['slot_type']
        }
      ],
      order: [[{ model: Model.student_masters, as: 'student' }, 'full_name', 'ASC']],
      limit: 50
    });

    /* -------- FORMAT RESPONSE -------- */
    const formatted = results.map(row => {
      const booking = row.toJSON();
      const seat = booking.seat_masters;
      const floor = seat?.floor_masters;
      const student = booking.student_masters;
      const plan = booking.payment_plans;
      const slot = booking.seat_slot_masters;

      return {
        seat_id: seat?.id,
        seat_number: seat?.seat_number,
        floor_name: floor?.floor_name || 'N/A',
        student_name: student?.full_name,
        student_code: student?.student_code,
        mobile_number: student?.mobile_number,
        end_date: booking.end_date,
        plan_name: plan?.plan_name,
        slot_type: slot?.slot_type
      };
    });

    return res.json({
      success: true,
      data: formatted
    });

  } catch (error) {
    console.error('Dashboard Search Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Search failed',
      error: error.message
    });
  }
};
