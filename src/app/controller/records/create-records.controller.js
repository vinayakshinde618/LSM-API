const Model = require("./../../models");
const { encryptedFunction } = require("generate-encrypted-password");
const { uniqueNumberCreate } = require('generate-unique-number')
const { uploadMediaFile } = require('upload-media-file');
const { getSchemaModels } = require("../commanFunctions/schemaModels.controller");

async function createRecords(params) {
    const transaction = await Model.sequelize.transaction(); // Start a transaction
    try {
        const { schema, relation, inputData, uniqueNo, uploadImage, modelName, password, isCompressRequired } = params;

        const Model = getSchemaModels(schema);

        // password encryption
        password ? await encryptedFunction(password, inputData) : null;

        // unique number function 
        uniqueNo ? await uniqueNumberCreate(inputData, uniqueNo) : null;

        // image upload function
        const uploadData = { type: 'create', inputData, uploadImage, isCompressRequired };
        uploadImage ? await uploadMediaFile(uploadData) : null;

        // relation data
        const relationIncludes = relation ? await relationIncludeFunction(relation) : [];

        // insert data
        const createdRecord = await Model[modelName].create(inputData, { include: relationIncludes, transaction });

        await transaction.commit();
        return { code: 1, message: "Success", data: createdRecord };
    } catch (error) {
        await transaction.rollback();
        if (error.name === 'SequelizeUniqueConstraintError') {
            return { code: 0, message: error.errors[0].message, data: [] };
        } else {
            return { code: 0, message: error.message, data: [] };
        }
    }
}
async function relationIncludeFunction(relation) {
    try {
        if (!relation) {
            return [];
        }
        const includeRelations = relation.map((item, i) => {
            var subRelationIncludes = [];
            if (item.subModelName != undefined && item.subModelName != "") {
                subRelationIncludes.push({ model: Model[item.subModelName], as: item.subModelName });
            }
            return { model: Model[item.modelName], as: item.as ?? item.modelName, include: subRelationIncludes }
        });
        return includeRelations;
    } catch (error) {
        console.error('Relation includes function error:', error);
        return [];
    }
}

module.exports = { createRecords }