const { getSchemaModels } = require("../commanFunctions/schemaModels.controller");
const Model = require("./../../models");

async function saveBulkData(params) {
    const { inputData, modelName, schema, payload } = params;

    const hooks = payload.hooks || false;

    const Model = getSchemaModels(schema);
    const transaction = await Model.sequelize.transaction() || null; // Start a transaction

    try {
        const recordsToCreate = inputData.filter(element => !element.id);
        const recordsToUpdate = inputData.filter(element => element.id);

        // Bulk update if there are records to update
        if (recordsToUpdate.length > 0) {
            await Promise.all(recordsToUpdate.map(async (element) => {
                await Model[modelName].update(element, { where: { id: element.id }, transaction, schemaModels: Model, individualHooks: hooks, customData: payload });
            }));
        }

        // Bulk create if there are records to create
        // if (recordsToCreate.length > 0) {
        //     await Model[modelName].bulkCreate(recordsToCreate, { transaction });
        // }

        // Bulk create if there are records to create
        if (recordsToCreate.length > 0) {
            if (params.oneByOne) {
                // Create records one by one
                for (const element of recordsToCreate) {
                    await Model[modelName].create(element, { transaction, schemaModels: Model, hooks: hooks });
                }
            } else {
                // Use bulk create
                await Model[modelName].bulkCreate(recordsToCreate, { transaction });
            }
        }

        await transaction.commit(); // Commit the transaction on success
        return true;
    } catch (error) {
        console.error("Save bulk record function error:", error);
        await transaction.rollback(); // Rollback the transaction on error
        return null;
    }
}

module.exports = { saveBulkData }