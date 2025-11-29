const { getSchemaModels } = require("../commanFunctions/schemaModels.controller");
const Model = require("./../../models");
const { uploadMediaFile } = require('upload-media-file');

async function updateRecords(params) {
    const transaction = await Model.sequelize.transaction(); // Start a transaction
    try {
        const { id, modelName, schema, inputData, uploadImage, relation, isCompressRequired } = params;

        const Model = getSchemaModels(schema);

        // find records by id
        const record = await Model[modelName].findByPk(id, { transaction });
        if (!record) {
            console.error('Record not found for id:', id);
            await transaction.rollback();
            return null;
        }
        Object.assign(record, inputData);

        // upload image function
        const uploadData = { type: 'update', inputData: record, uploadImage, isCompressRequired };
        uploadImage ? await uploadMediaFile(uploadData) : null;

        // update data
        await record.save({ transaction });

        // insert or update sub module
        if (relation) {
            const updateNestedModelResponse = await updateNestedModelData(id, relation, transaction);
            if (!updateNestedModelResponse) {
                await transaction.rollback();
                return null;
            }
        }

        await transaction.commit(); // Commit the transaction on success
        return { code: 1, message: "Success", data: record };
    } catch (error) {
        await transaction.rollback();
        if (error.name === 'SequelizeUniqueConstraintError') {
            return { code: 0, message: error.errors[0].message, data: [] };
        } else {
            return { code: 0, message: error.message, data: [] };
        }
    }
}
// Update multiple records in a single query
async function updateNestedModelData(id, relation, transaction) {
    try {
        // second means sub module update or create
        const { subModelName, subSubModelName, subModelInputData } = relation;
        if (subModelName || subModelInputData) {
            await Promise.all(
                subModelInputData.map(async (record) => {
                    // Update or create the record based on the condition
                    record[relation.subModelForeignKey] = id;
                    record.id !== undefined
                        ? await Model[subModelName].update(record, { where: { id: record.id }, transaction })
                        : await Model[subModelName].create(record, { transaction });

                    // sub sub model input data
                    const subSubModelInputData = record.subSubModelInputData
                    if (subSubModelName || subSubModelInputData) {
                        const updateSubSubModelResponse =
                            subSubModelInputData.map(record =>
                                record.id ?
                                    Model[subSubModelName].update(record, { where: { id: record.id }, transaction }) :
                                    Model[subSubModelName].create(record, { transaction })
                            );
                        await Promise.all(updateSubSubModelResponse);
                    }
                })
            );
        }
        return true;
    } catch (error) {
        console.error("Update nested model data function error:", error);
        return null;
    }
};

module.exports = { updateRecords }