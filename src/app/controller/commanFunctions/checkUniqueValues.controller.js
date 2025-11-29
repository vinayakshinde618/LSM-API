
/**
 * Common function to validate uniqueness with case-insensitive check for a specific column.
 * @param {Model} modelName - The Sequelize model to query.
 * @param {string} [uniqueColumn] - The column name for which case-insensitive uniqueness needs to be validated.
 * @param {Object} whereCondition - The condition to check for uniqueness.
 * @param {Object} transaction - Optional transaction object.
 * @param {string} [errorMessage] - Custom error message to throw if validation fails.
 * @param {number} [currentRecordId] - The ID of the record being updated (optional).
 * @throws Will throw an error if the record already exists.
 */

const { getSchemaModels } = require("./schemaModels.controller");
const { Op } = require('sequelize');

async function checkUniqueValue({
  modelName,
  whereCondition,
  errorMessage = 'Record already exists',
  currentRecordId = null,
  transaction = null,
  schema = 'public',
}) {
  const sequelize = modelName.sequelize; // Correctly get sequelize instance from the model
  // const { Op } = sequelize;

  const whereClause = {};

  // Process each field in whereCondition
  for (const [key, condition] of Object.entries(whereCondition)) {
    const { value, caseSensitive = false } = condition;

    const trimmedValue = typeof value === 'string'
      ? value.trim().replace(/\s+/g, ' ')
      : value;

    whereClause[key] = caseSensitive
      ? trimmedValue
      : sequelize.where(sequelize.fn('LOWER', sequelize.col(key)), sequelize.fn('LOWER', trimmedValue));
  }

  // Exclude current record by ID
  if (currentRecordId) {
    whereClause.id = { [Op.ne]: currentRecordId };
  }

  const record = await modelName.findOne({ where: whereClause, transaction });
  if (record) throw new Error(errorMessage);
}

async function checkUniqueValueAcrossAllSchemas({
  modelName,
  whereCondition,
  errorMessage = 'Record already exists',
  currentRecordId = null,
  transaction = null,
  schema = 'public',
  allSchemas = false
}) {
  const sequelize = modelName.sequelize;
  // const { Op } = sequelize;
  const { Op } = require('sequelize')

  const whereClause = {};

  // Process each field in whereCondition
  for (const [key, condition] of Object.entries(whereCondition)) {
    const { value, caseSensitive = false } = condition;

    const trimmedValue = typeof value === 'string'
      ? value.trim().replace(/\s+/g, ' ')
      : value;

    whereClause[key] = caseSensitive
      ? trimmedValue
      : sequelize.where(sequelize.fn('LOWER', sequelize.col(key)), sequelize.fn('LOWER', trimmedValue));
  }

  // Exclude current record by ID
  if (currentRecordId) {
    whereClause.id = { [Op.ne]: currentRecordId };
  }

  if (allSchemas) {
    // Get all schemas
    const schemas = await getAllCustomSchemas();

    // Check each schema
    for (const schema of schemas) {

      const Model = getSchemaModels(schema);

      const record = await Model[modelName.name].findOne({ where: whereClause, transaction });
      if (record) {
        throw new Error(errorMessage);
      }
    }
  } else if (schema) {
    const Model = getSchemaModels(schema);

    // Original single-schema check
    const record = await Model[modelName.name].findOne({ where: whereClause, transaction });
    if (record) throw new Error(errorMessage);
  }
}

async function getAllCustomSchemas() {
  const Model = require('./../../models');
  const [schemas] = await Model.sequelize.query(`
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name NOT LIKE 'pg_%' 
    AND schema_name NOT IN ('information_schema', 'admin_config') 
    ORDER BY schema_name
  `);
  return schemas.map(s => s.schema_name);
}

async function findOrCreateAndReturnId({
  model,
  schema,
  where,
  defaults = {},
  transaction,
  context = {},
  Models
}) {

  const record = await Models[model].findOne({ where, transaction });

  if (record) {
    return record.id;
  }

  console.log({ ...defaults });

  const created = await Models[model].create(defaults, { transaction, context: context, schemaModels: Models });

  return created.id;

}

module.exports = { checkUniqueValue, findOrCreateAndReturnId, checkUniqueValueAcrossAllSchemas };
