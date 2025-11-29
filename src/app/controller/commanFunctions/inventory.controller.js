const { Sequelize } = require("sequelize");
const { getSchemaModels } = require('../commanFunctions/schemaModels.controller');

/**
 * Common function to create logs for inventory changes.
 */
async function createInventoryLog({
  organization_id,
  inventory_id,
  branch_id,
  warehouse_id,
  item_category_id,
  item_id,
  quantity = 0,
  hold_qty = 0,
  scrap_qty = 0,
  rejected_qty = 0,
  heat_numbers = [],
  type,
  is_active = true,
  created_by = null,
  Model,
  transaction
}) {
  return await Model.inventory_logs.create({
    organization_id,
    inventory_id,
    branch_id,
    warehouse_id,
    item_category_id,
    item_id,
    quantity,
    hold_qty,
    scrap_qty,
    rejected_qty,
    heat_numbers,
    type,
    is_active: 'Active',
    created_by
  }, { transaction });
}

/**
 * 1. Add stock quantity
 */
async function addStock(transaction, Model, params) {
  const {
    organization_id,
    branch_id,
    warehouse_id,
    item_category_id,
    item_id,
    quantity,
    is_active = true,
    type
  } = params;

  let inventory = await Model.inventories.findOne({
    where: {
      organization_id,
      branch_id,
      warehouse_id,
      item_category_id,
      item_id,
    },
    transaction
  });

  if (inventory) {
    // ADD HEAT NUMBERS HANDLING HERE
    if (params.heat_numbers && params.heat_numbers.length > 0) {
      inventory.heat_numbers = await handleHeatNumbers(
        inventory,
        params.heat_numbers,
        params.replaceExisting || false
      );

      // Mark the field as changed
      inventory.changed('heat_numbers', true);
    }

    inventory.quantity = (inventory.quantity || 0) + quantity;
    await inventory.save({ transaction });

    params.heat_numbers = inventory.heat_numbers; // Update for log creation

  } else {
    inventory = await Model.inventories.create({
      organization_id,
      branch_id,
      warehouse_id,
      item_category_id,
      item_id,
      quantity,
      hold_qty: 0,
      scrap_qty: 0,
      rejected_qty: 0,
      heat_numbers: params.heat_numbers || [], // Add heat numbers for new inventory
      is_active: 'Active',
    }, { transaction });
  }

  await createInventoryLog({
    ...params,
    inventory_id: inventory.id,
    quantity,
    type: type || "ADD_STOCK",
    Model,
    transaction
  });

  return {
    success: true,
    message: "Stock added successfully",
    data: inventory,
  };
}

/**
 * 2. Add hold quantity
 */
async function addHoldQty(params) {
  const {
    organization_id,
    branch_id,
    warehouse_id,
    item_category_id,
    item_id,
    hold_qty,
    is_active = true,
    operationType,
    Model,
    transaction
  } = params;

  const inventory = await Model.inventories.findOne({
    where: {
      organization_id,
      branch_id,
      warehouse_id,
      item_category_id,
      item_id,
    },
    transaction
  });

  if (!inventory) {
    throw new Error("Inventory not found");
  }

  inventory.hold_qty = (inventory.hold_qty || 0) + hold_qty;
  await inventory.save({ transaction });

  await createInventoryLog({
    ...params,
    inventory_id: inventory.id,
    hold_qty,
    created_by: params.userId || null, // Pass userId if available
    type: operationType ? operationType : "ADD_HOLD_QTY",
    Model,
    transaction
  });

  return {
    success: true,
    message: "Hold quantity added successfully",
    data: inventory,
  };
}

/**
 * 3. Add rejected quantity
 */
async function addRejectedQty(params) {
  const {
    organization_id,
    branch_id,
    warehouse_id,
    item_category_id,
    item_id,
    rejected_qty,
    is_active = true,
  } = params;

  const inventory = await Model.inventories.findOne({
    where: {
      organization_id,
      branch_id,
      warehouse_id,
      item_category_id,
      item_id,
    },
  });

  if (!inventory) {
    throw new Error("Inventory not found");
  }

  inventory.rejected_qty = (inventory.rejected_qty || 0) + rejected_qty;
  await inventory.save();

  await createInventoryLog({
    ...params,
    inventory_id: inventory.id,
    rejected_qty,
    type: "ADD_REJECTED_QTY",
  });

  return {
    success: true,
    message: "Rejected quantity added successfully",
    data: inventory,
  };
}

/**
 * 4. Add scrap quantity
 */
async function addScrapQty(params) {
  const {
    organization_id,
    branch_id,
    warehouse_id,
    item_category_id,
    item_id,
    scrap_qty,
    is_active = true,
  } = params;

  const inventory = await Model.inventories.findOne({
    where: {
      organization_id,
      branch_id,
      warehouse_id,
      item_category_id,
      item_id,
    },
  });

  if (!inventory) {
    throw new Error("Inventory not found");
  }

  inventory.scrap_qty = (inventory.scrap_qty || 0) + scrap_qty;
  await inventory.save();

  await createInventoryLog({
    ...params,
    inventory_id: inventory.id,
    scrap_qty,
    type: "ADD_SCRAP_QTY",
  });

  return {
    success: true,
    message: "Scrap quantity added successfully",
    data: inventory,
  };
}

/**
 * 5. Remove quantity → deduct from hold_qty first, then stock.
 */
async function removeHoldAndStockQty(params) {
  const {
    organization_id,
    branch_id,
    warehouse_id,
    item_category_id,
    item_id,
    qty, // single qty parameter
    is_active = 'Active',
    Model,
    transaction,
    operationType,
    type
  } = params;

  const inventory = await Model.inventories.findOne({
    where: {
      organization_id,
      branch_id,
      warehouse_id,
      item_category_id,
      item_id,
    },
    transaction
  });

  if (!inventory) {
    throw new Error("Inventory not found");
  }

  if (operationType == 'hold') {
    if (Number(inventory.hold_qty || 0) < Number(qty || 0)) {
      throw new Error("Insufficient hold quantity in inventory");
    }
    inventory.hold_qty = Number(inventory.hold_qty || 0) - Number(qty || 0);
  }
  else if (operationType == 'stock') {
    if (Number(inventory.quantity || 0) < Number(qty || 0)) {
      throw new Error("Insufficient stock quantity in inventory");
    }
    inventory.quantity = Number(inventory.quantity || 0) - Number(qty || 0);
  }
  else {
    inventory.hold_qty = Number(inventory.hold_qty || 0) - Number(qty || 0);
    inventory.quantity = Number(inventory.quantity || 0) - Number(qty || 0);
  }

  // ADD HEAT NUMBERS HANDLING HERE
  if (params.heat_numbers && params.heat_numbers.length > 0) {
    inventory.heat_numbers = await handleHeatNumbers(
      inventory,
      params.heat_numbers,
      true
    );

    // Mark the field as changed
    inventory.changed('heat_numbers', true);

    params.heat_numbers = inventory.heat_numbers; // Update for log creation
  }

  await inventory.save({ transaction });

  // Create a single log entry
  await createInventoryLog({
    ...params,
    inventory_id: inventory.id,
    hold_qty: qty,
    quantity: qty,
    type: type || "REMOVE_QTY",
    Model,
    transaction
  });

  return {
    success: true,
    message: "Quantity removed successfully",
    data: {}
  };
}

async function manageInventoryStockManually(req, res) {
  const { schema, inputData, created_by } = req.body;

  if (!schema) return res.status(400).json({ code: 0, error: "Schema is required" });
  if (!inputData || !Array.isArray(inputData) || inputData.length === 0) {
    return res.status(400).json({ code: 0, error: "inputData array is required" });
  }

  const Model = getSchemaModels(schema);
  const transaction = await Model.sequelize.transaction();

  try {
    const inventoryRecords = [];

    // Process each inventory item in the inputData array
    for (const itemData of inputData) {
      const { branch_id, warehouse_id, item_category_id, item_id, organization_id, quantity = 0, is_active, heat_numbers } = itemData;

      if (!branch_id || !warehouse_id || !item_category_id || !item_id) {
        throw new Error("Missing required fields: branch_id, warehouse_id, item_category_id, or item_id");
      }

      // Use addStock function to handle both creation and updating
      let inventory = await Model.inventories.findOne({
        where: {
          organization_id,
          branch_id,
          warehouse_id,
          item_category_id,
          item_id,
        },
      });

      if (inventory) {
        inventory.quantity = quantity || 0;
        if(heat_numbers && heat_numbers.length > 0) {
          inventory.heat_numbers = heat_numbers;
          inventory.changed('heat_numbers', true);
        }
        await inventory.save();
      } else {
        inventory = await Model.inventories.create({
          organization_id,
          branch_id,
          warehouse_id,
          item_category_id,
          item_id,
          quantity,
          hold_qty: 0,
          scrap_qty: 0,
          rejected_qty: 0,
          heat_numbers: heat_numbers || [],
          is_active: 'Active',
        });
      }

      await createInventoryLog({
        ...itemData,
        created_by,
        inventory_id: inventory.id,
        quantity,
        type: "MANUAL",
        Model
      });


      inventoryRecords.push(inventory);
    }

    await transaction.commit();

    return res.json({
      code: 1,
      success: true,
      message: "Inventories processed successfully",
      data: inventoryRecords
    });

  } catch (error) {
    await transaction.rollback();
    console.error('Error processing inventories:', error);
    return res.status(500).json({ code: 0, success: false, message: error.message });
  }
}

/**
 * Adds stock if the current operation is the last in the batch.
 *
 * @param {Object} params
 * @param {Object} params.Models - All schema models.
 * @param {Object} params.operation - The job_card_operations instance.
 * @param {Object} params.job_card - The related job_card instance.
 * @param {Object} params.customData - Custom input data, must include accepted_qty and warehouse_id.
 * @param {Object} params.transaction - Sequelize transaction.
 */
async function addStockIfLastOperation({
  Models,
  operation,
  organization_id,
  branch_id,
  warehouse_id,
  item_category_id,
  item_id,
  quantityToAdd = 0,
  transaction,
  type = 'Job Card'
}) {
  const allOperationsInBatch = await Models.job_card_operations.findAll({
    where: {
      batch_number: operation.batch_number,
      is_active: 'Active'
    },
    include: [{
      model: Models.wo_item_bom_operations,
      as: 'bomOperation',
      attributes: ['sequence_no']
    }],
    transaction
  });

  if (!allOperationsInBatch?.length) return;

  // Sort by sequence_no descending to get the last operation
  allOperationsInBatch.sort((a, b) => {
    return b.bomOperation.sequence_no - a.bomOperation.sequence_no;
  });

  const lastOperation = allOperationsInBatch[0];

  if (lastOperation.id !== operation.id) return;

  if (quantityToAdd > 0) {
    await addStock(transaction, Models, {
      organization_id,
      branch_id,
      warehouse_id,
      item_category_id,
      item_id,
      quantity: quantityToAdd,
      is_active: true,
      type,
      Model: Models,
      transaction
    });
  }
  console.log("abc")
}

async function handleHeatNumbers(inventory, newHeatNumbers, replaceExisting = false) {
  if (!newHeatNumbers || newHeatNumbers.length === 0) {
    return inventory.heat_numbers || [];
  }

  const existingHeatNumbers = inventory.heat_numbers || [];
  let updatedHeatNumbers = replaceExisting ? [] : [...existingHeatNumbers];

  for (const newHeat of newHeatNumbers) {
    const existingIndex = updatedHeatNumbers.findIndex(
      heat => heat.heat_number === newHeat.heat_number
    );

    if (existingIndex !== -1) {
      if (replaceExisting) {
        // Replace existing heat number quantity
        updatedHeatNumbers[existingIndex].quantity = parseFloat(newHeat.quantity);
      } else {
        // Add to existing heat number quantity
        updatedHeatNumbers[existingIndex].quantity =
          parseFloat(updatedHeatNumbers[existingIndex].quantity) +
          parseFloat(newHeat.quantity);
      }
    } else {
      // Add new heat number
      updatedHeatNumbers.push({
        heat_number: newHeat.heat_number,
        quantity: parseFloat(newHeat.quantity)
      });
    }
  }

  return updatedHeatNumbers;
}

module.exports = {
  addStock,
  addHoldQty,
  addRejectedQty,
  addScrapQty,
  removeHoldAndStockQty,
  manageInventoryStockManually,
  addStockIfLastOperation
};
