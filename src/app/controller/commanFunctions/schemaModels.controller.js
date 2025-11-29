function getSchemaModels(schema = 'xyz') {
    const models = require("./../../models");
    const updatedModels = {};
    for (const modelName in models) {
        if (typeof models[modelName].schema === 'function') {
            updatedModels[modelName] = models[modelName].schema(schema);
        } else {
            updatedModels[modelName] = models[modelName];
        }
    }
    return updatedModels;
}

module.exports = { getSchemaModels }