const Model = require('../../models');
const { createRecords } = require('./../records/create-records.controller');
const { updateRecords } = require('./../records/update-records.controller');
const { saveBulkData } = require('./../records/save-bulk-records.controller');
const { getRecord } = require('./../records/get-records.controller');
const fs = require('fs');
const path = require('path');
const { getSchemaModels } = require('../commanFunctions/schemaModels.controller');
const { Op } = require("sequelize");
const { roundTo } = require('../commanFunctions/commanFunctions.controller');

// master create and update
exports.saveRecords = async (req, res) => {
  try {
    const { schema, id, modelName, uploadImage, uniqueNo, relation, inputData, password, isCompressRequired = false, oneByOne = false } = req.body;

    // Model validation
    if (!modelName || !Model[modelName]) { return res.fail('Invalid or Missing Model Name', []); }
    if (!inputData) { return res.fail('Input Data is Required', ''); }

    const data = { schema, id, modelName, inputData, relation, uploadImage, uniqueNo, password, isCompressRequired, oneByOne, payload: req.body };

    if (Array.isArray(inputData) && inputData.length > 0) { // save bulk data
      const saveBulkDataResponse = await saveBulkData(data);
      if (!saveBulkDataResponse) { return res.fail('Error while saving bulk records!', []); }
      return res.success('Bulk Records Saved!', []);
    } else if (id) { // update
      const updateRecordResponse = await updateRecords(data);
      if (updateRecordResponse?.code == 0) { return res.fail(updateRecordResponse?.message || 'Error while updating records!', []); }
      return res.success('Record Updated', updateRecordResponse?.data);
    } else { // insert
      const createRecordsResponse = await createRecords(data);
      if (createRecordsResponse?.code == 0) { return res.fail(createRecordsResponse?.message || 'Error while creating records!', []); }
      return res.success('Record Created', createRecordsResponse?.data);
    }
  } catch (err) {
    console.error('Save records function error:', err);
    return res.catchError(err.message);
  }
};

exports.getRecords = async (req, res) => {
  try {
    const { modelName, schema = 'public' } = req.body;
    // Model validation
    if (!modelName || !Model[modelName]) { return res.fail('Invalid or Missing Model Name', []); }
    if (!schema) { return res.fail('Missing Schema Name', []); }

    const getRecordsResponse = await getRecord(req.body);
    if (!getRecordsResponse && !getRecordsResponse?.rows) { return res.fail(`No records found for ${modelName} this model`, []); }

    let { rows, count } = getRecordsResponse;

    return res.success('Data retrieved successfully', rows, count);
  } catch (err) {
    console.error('Get records error:', err);
    return res.fail('Internal Server Error', err.message);
  }
};

exports.uploadBinaryFile = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) { return res.fail('No files uploaded', []); }

    // Collect all file information
    const filesInfo = req.files.map(file => ({
      filePath: file.path,
      fileName: file.filename
    }));
    return res.success('Files uploaded successfully!', filesInfo);
  } catch (err) {
    console.error('Upload binary file error:', err);
    return res.fail('Internal Server Error', err.message);
  }
};

exports.modelList = async (req, res) => {
  try {
    const modelsDir = path.join(__dirname, '../../models');
    fs.readdir(modelsDir, (err, files) => {
      if (err) {
        console.error('Error reading models directory:', err);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
      }

      const modelNames = files.filter(file => file.endsWith('.js')).map(file => path.parse(file).name); // Get the name without the extension
      return res.success('Model List', modelNames);
    });
  } catch (error) {
    console.error('Error fetching model names:', error);
    return catchError('Internal Server Error', []);
  }
};
exports.columnListByModel = async (req, res) => {
  const { modelName } = req.params;
  try {
    // Check if the model is defined in Sequelize
    const model = Model[modelName];
    if (!model) {
      return res.status(404).json({
        success: false,
        message: `Model "${modelName}" not found`
      });
    }

    // Describe the table to get column information
    const tableDescription = await Model.sequelize.queryInterface.describeTable(model.tableName);

    const columnNames = Object.keys(tableDescription);
    return res.success(`${modelName} column list`, columnNames);
  } catch (error) {
    console.error('Error fetching column names:', error);
    return res.catchError('Internal Server Error', []);
  }
};

// 
// Example Express.js routes
exports.schemaList = async (req, res) => {
  // Return all available schemas
  const result = await Model.sequelize.query("SELECT schema_name FROM information_schema.schemata;");
  res.json({ code: 1, data: result[0].map(r => r.schema_name) });
};

exports.runQuery = async (req, res) => {
  const { schema, query } = req.body;
  try {
    const result = await Model.sequelize.query(`SET search_path TO ${schema}; ${query}`);
    res.json({ code: 1, data: result[0] || [], message: "Query executed successfully" });
  } catch (err) {
    res.json({ code: 0, message: err.message });
  }
};


exports.syncDatabase = async (req, res) => {
  try {
    const { type } = req.params;
    let data = { alter: false };
    if (type == 'alter') {
      // alter true
      data = { alter: true };
    }
    if (type == 'force') {
      // force true
      data = { force: true };
    }
    // // Sync user_masters table first
    // await Model.user_masters.sync(data);
    // console.log('user_masters table synced successfully');

    await Model.wos.sync(data);
    console.log('wos table synced successfully');

    // Perform sync with alter option
    await Model.sequelize.sync(data);

    res.status(200).json({
      status: 'success',
      message: 'Database synced successfully with alter: true'
    });
  } catch (error) {
    console.error('Error syncing database:', error);
    res.status(500).json({
      status: 'Database sync failed',
      message: error.message,
      error: error
    });
  }
};

exports.updaterelationaldata = async (req, res) => {
  if (!req.body.modelName) {
    return res.fail('Model Name required', []);
  }
  // if (!req.body.relation) {
  //     return res.fail("Relation required", []);
  // }
  if (!req.body.inputData) {
    return res.fail('Input Data required', []);
  }

  let { modelName, schema = 'public', id, relation, inputData, forceSave } = req.body;

  if (!relation) {
    relation = [];
  }

  if (!modelName || !Array.isArray(relation)) {
    return res.fail('Provide valid modelName!');
  }

  if (!schema || !Array.isArray(relation)) {
    return res.fail('Provide schema!');
  }

  const Model = getSchemaModels(schema);

  let useTransaction = req.body.useTransaction !== false;
  const transaction = useTransaction ? await Model.sequelize.transaction() : null;

  try {
    // If ID is not provided, create the record first
    let parentRecord;
    if (id) {
      // If ID is provided, update the parent record
      parentRecord = await Model[modelName].findByPk(id, { transaction, schemaModels: Model });
      if (!parentRecord) {
        if (useTransaction) await transaction.rollback();  // Rollback if no record is found
        return res.fail('Parent record not found');
      }

      // // Force update by including `updatedAt` in the inputData
      // const newDate = new Date();
      // // inputData.updatedAt = newDate;
      // parentRecord.changed('updatedAt', true); // Force update by marking `updatedAt` as changed
      // // parentRecord.updatedAt = newDate;

      // // Update the parent record with inputData
      // await parentRecord.update(inputData, { customData: { inputData } }, { transaction });


      Object.assign(parentRecord, inputData);

      const newDate = new Date();
      // Force update `updatedAt` without marking other fields as changed
      parentRecord.setDataValue('updatedAt', newDate);

      // Save the record to trigger `afterSave` hook
      await parentRecord.save({ customData: req.body, transaction, schemaModels: Model });

    } else {
      // If no ID is provided, create a new record
      parentRecord = await Model[modelName].create(inputData, {
        customData: req.body,
        transaction, schemaModels: Model
      });
    }

    // Get the id of the parent record (either newly created or updated)
    const parentId = parentRecord.id;
    console.log('here 11');

    // Now, handle relations (child models)
    for (let i = 0; i < relation.length; i++) {
      const module = relation[i].moduleAs;
      const moduleName = relation[i].modelName;
      const foreignKey = relation[i].foreignKey ?? await getForeignKeyName(Model[modelName], Model[moduleName]);
      const hooks = relation[i].hooks == false ? false : true;
      console.log('here 12');

      if (module in inputData && foreignKey) {
        if (inputData[module] && inputData[module].length > 0) {
          for (let j = 0; j < inputData[module].length; j++) {
            const element = inputData[module][j];
            element[foreignKey] = parentId;  // Use the parentId for the child model

            let childRecord = null;

            if (element.id) {
              // Find the existing record by its ID
              const existingRecord = await Model[moduleName].findOne({ where: { id: element.id }, transaction, schemaModels: Model });
              console.log('here 13');

              if (existingRecord) {
                // Update the record using save()
                existingRecord.set(element); // Set the new values to the record
                if (element.forceSave) {
                  existingRecord.changed('updatedAt', true); // Force update by marking `updatedAt` as changed
                }

                childRecord = existingRecord; // Keep a reference to the updated record

                await existingRecord.save({
                  customData: req.body,
                  element,
                  transaction, schemaModels: Model,
                  hooks
                });
              }
            } else {
              try {
                console.log('here 14', element);

                childRecord = await Model[moduleName].create(element, {
                  customData: req.body,
                  element,
                  transaction,
                  schemaModels: Model,
                });

                console.log('here 15');
              } catch (err) {
                console.error('Error creating child record:', err);
                throw err;
              }
            }

            parentRecord[`child_${module}`] // if exists and an array then push the child record
            if (Array.isArray(parentRecord[`child_${module}`])) {
              parentRecord[`child_${module}`].push(childRecord);
            } else {
              parentRecord[`child_${module}`] = [childRecord]; // Initialize as an array if it doesn't exist
            }
          }
        }
      }
    }
    // Commit the transaction if everything is successful
    // await transaction.commit();
    if (useTransaction) await transaction.commit();
    console.log('here 18');

    // Return success response with the updated or created record
    return res.success('Successfully save the record', parentRecord);
  } catch (error) {
    console.log('here 19');

    console.error("Error inserting invoice_items:", error.parent?.detail || error);
    if (useTransaction) await transaction.rollback(); // Rollback the transaction on error
    return res.fail(error.message);
  }
};

exports.saveUpdateRecords = async (req, res) => {
  if (!req.body.modelName) {
    return res.fail('Model Name required', []);
  }
  if (!req.body.inputData) {
    return res.fail('Input Data required', []);
  }

  const { modelName, schema = 'public', id, relation, inputData, forceSave } = req.body;
  const Model = getSchemaModels(schema);
  const useTransaction = req.body.useTransaction !== false;
  const transaction = useTransaction ? await Model.sequelize.transaction() : null;

  try {
    let results;
    const params = {
      modelName,
      schema,
      id,
      relation: relation || [],
      forceSave,
      useTransaction,
      checkAfterSave: req.body.checkAfterSave,
      Model,
      transaction
    };

    if (Array.isArray(inputData)) {
      // Handle array input
      results = [];
      for (const singleInput of inputData) {
        const result = await saveUpdateRecordFunction({
          ...params,
          inputData: singleInput
        });
        results.push(result.data);
      }
    } else {
      // Handle single object input
      const result = await saveUpdateRecordFunction({
        ...params,
        inputData
      });
      results = result.data;
    }

    if (useTransaction) await transaction.commit();
    return res.success('Successfully saved the record(s)', results);
  } catch (error) {
    if (useTransaction) await transaction.rollback();
    return res.fail(error.message);
  }
};

const saveUpdateRecordFunction = async (params) => {
  const {
    modelName,
    schema = 'public',
    id,
    relation = [],
    inputData,
    forceSave,
    useTransaction = true,
    checkAfterSave,
    Model, // Pass the Model from controller
    transaction = null // Optional transaction from controller
  } = params;

  try {
    // If ID is not provided, create the record first
    let parentRecord;
    if (id) {
      // If ID is provided, update the parent record
      parentRecord = await Model[modelName].findByPk(id, { transaction, schemaModels: Model });
      if (!parentRecord) {
        return { success: false, message: 'Parent record not found' };
      }

      Object.assign(parentRecord, inputData);
      const newDate = new Date();
      parentRecord.setDataValue('updatedAt', newDate);
      await parentRecord.save({ customData: params, transaction, schemaModels: Model });
    } else {
      // If no ID is provided, create a new record
      parentRecord = await Model[modelName].create(inputData, {
        customData: params,
        transaction,
        schemaModels: Model
      });
    }

    const parentId = parentRecord.id;

    // Handle relations (child models)
    for (let i = 0; i < relation.length; i++) {
      const module = relation[i].moduleAs;
      const moduleName = relation[i].modelName;
      const foreignKey = relation[i].foreignKey ?? await getForeignKeyName(Model[modelName], Model[moduleName]);
      const hooks = relation[i].hooks == false ? false : true;

      if (module in inputData && foreignKey) {
        if (inputData[module] && inputData[module].length > 0) {
          for (let j = 0; j < inputData[module].length; j++) {
            const element = inputData[module][j];
            element[foreignKey] = parentId;

            let childRecord = null;

            if (element.id) {
              const existingRecord = await Model[moduleName].findOne({
                where: { id: element.id },
                transaction,
                schemaModels: Model
              });

              if (existingRecord) {
                existingRecord.set(element);
                if (element.forceSave) {
                  existingRecord.changed('updatedAt', true);
                }
                childRecord = existingRecord;
                await existingRecord.save({
                  customData: params,
                  element,
                  transaction,
                  schemaModels: Model,
                  hooks
                });
              }
            } else {
              childRecord = await Model[moduleName].create(element, {
                customData: params,
                element,
                transaction,
                schemaModels: Model
              });
            }

            if (Array.isArray(parentRecord[`child_${module}`])) {
              parentRecord[`child_${module}`].push(childRecord);
            } else {
              parentRecord[`child_${module}`] = [childRecord];
            }
          }
        }
      }
    }

    return { success: true, data: parentRecord };
  } catch (error) {
    console.error('Error:', error);
    throw error; // Let the controller handle the error
  }
};

async function getForeignKeyName(parentModel, childModel) {
  try {
    const associations = Object.values(childModel.associations);
    for (const association of associations) {
      if (association.target.name == parentModel.name) {
        return association.foreignKey;
      }
    }
  } catch (err) {
    console.log('err', err);
  }
}


exports.createUpdateRecords = async (req, res) => {
  if (!req.body.modelName) {
    return res.fail('Model Name required', []);
  }
  if (!req.body.inputData) {
    return res.fail('Input Data required', []);
  }

  let { modelName, schema = 'public', id, relation = [], inputData, forceSave } = req.body;

  if (!modelName || !Array.isArray(relation)) {
    return res.fail('Provide valid modelName!');
  }

  if (!schema) {
    return res.fail('Provide schema!');
  }

  const Model = getSchemaModels(schema);
  const transaction = await Model.sequelize.transaction();

  try {
    // Handle parent record (create or update)
    let parentRecord;
    if (id) {
      parentRecord = await Model[modelName].findByPk(id, { transaction, schemaModels: Model });
      if (!parentRecord) {
        await transaction.rollback();
        return res.fail('Parent record not found');
      }

      Object.assign(parentRecord, inputData);
      parentRecord.setDataValue('updatedAt', new Date());
      await parentRecord.save({ customData: req.body, transaction, schemaModels: Model });
    } else {
      parentRecord = await Model[modelName].create(inputData, {
        customData: req.body,
        transaction, schemaModels: Model
      });
    }

    const parentId = parentRecord.id;

    // Process relations recursively
    await processRelationsRecursively({
      relations: relation,
      inputData,
      parentId,
      parentModelName: modelName,
      schema,
      req,
      transaction
    });

    await transaction.commit();
    return res.success('Successfully saved the record', parentRecord);
  } catch (error) {
    console.error('Error:', error);
    await transaction.rollback();
    return res.fail(error.message);
  }
};

// Helper function to process relations recursively
async function processRelationsRecursively({
  relations,
  inputData,
  parentId,
  parentModelName,
  schema,
  req,
  transaction,
  parentPath = [],
  parentIds = {} // Track all parent IDs in the hierarchy
}) {
  const Model = getSchemaModels(schema);

  for (const rel of relations) {
    const module = rel.moduleAs;
    const moduleName = rel.modelName;
    const foreignKey = rel.foreignKey || await getForeignKeyName(Model[parentModelName], Model[moduleName]);
    const hooks = rel.hooks !== false;
    const nestedRelations = rel.relation || [];

    const woItemBomIds = [];

    // Build the path to the current data
    const currentPath = [module];
    const currentData = getNestedData(inputData, currentPath);

    if (currentData && currentData.length > 0 && foreignKey) {
      for (const element of currentData) {
        // Set the immediate parent ID
        element[foreignKey] = parentId;

        // Set all ancestor IDs from the hierarchy
        for (const [key, value] of Object.entries(parentIds)) {
          if (!element[key]) {
            element[key] = value;
          }
        }

        if (element.id) {
          // Update existing record
          const existingRecord = await Model[moduleName].findOne({
            where: { id: element.id },
            transaction, schemaModels: Model
          });

          if (existingRecord) {
            existingRecord.set(element);
            if (element.forceSave) {
              existingRecord.changed('updatedAt', true);
            }
            await existingRecord.save({
              customData: req.body,
              element,
              transaction,
              hooks, schemaModels: Model
            });
          }
        } else {
          // For sale work orders, the user sends the object without the primary ID.
          // If the record exists in wo_item_boms, update it; otherwise, create a new one.
          if (moduleName === 'wo_item_boms') {
            const existingRecord = await handleWoItemBomsCreate(Model, moduleName, element, {
              req,
              transaction,
              hooks
            });

            if (existingRecord) {
              element.id = existingRecord.id; // Set ID for nested relations
            }
            else {
              // Create new record
              const data = await Model[moduleName].create(element, {
                customData: req.body,
                element,
                transaction,
                hooks, schemaModels: Model
              });

              element.id = data.id;
            }

            woItemBomIds.push(element.id);
            continue; // Skip to next element since we updated existing
          }

          // Create new record
          const data = await Model[moduleName].create(element, {
            customData: req.body,
            element,
            transaction,
            hooks, schemaModels: Model
          });

          element.id = data.id;
        }

        // Process nested relations if they exist and we have an ID
        if (nestedRelations.length > 0 && element.id) {
          // Create new parentIds object with current relationship added
          const newParentIds = {
            ...parentIds,
            [foreignKey]: parentId // Add current parent relationship
          };

          await processRelationsRecursively({
            relations: nestedRelations,
            inputData: element,
            parentId: element.id,
            parentModelName: moduleName,
            schema,
            req,
            transaction,
            parentPath: currentPath,
            parentIds: newParentIds // Pass down all parent IDs
          });
        }
      }
    }

    if (woItemBomIds.length > 0 && module == 'wo_item_boms') {
      // After processing all wo_item_boms, update the parent record with collected IDs
      await Model[module].update(
        { is_active: 'Inactive', deletedAt: new Date() },
        {
          where: {
            id: {
              [Op.notIn]: woItemBomIds
            },
            wo_item_id: parentId
          },
          transaction,
          hooks: false,
          schemaModels: Model
        }
      );
    }
  }
}

// Helper function for wo_item_boms duplications
async function handleWoItemBomsCreate(Model, moduleName, element, options) {
  if (moduleName !== 'wo_item_boms') {
    return null; // Not the target model, proceed with normal create
  }

  // Check for duplicate wo_item_boms record
  const duplicate = await Model[moduleName].findOne({
    where: {
      wo_id: element.wo_id,
      wo_item_id: element.wo_item_id,
      item_id: element.item_id,
      bom_id: element.bom_id,
      is_active: 'Active'
    },
    transaction: options.transaction,
    schemaModels: Model
  });

  if (duplicate) {
    await Model[moduleName].update(
      { ...element },  // update with all fields from element
      {
        where: {
          wo_id: element.wo_id,
          wo_item_id: element.wo_item_id,
          item_id: element.item_id,
          bom_id: element.bom_id,
          is_active: 'Active'
        },
        transaction: options.transaction,
        hooks: options.hooks,
        schemaModels: Model
      }
    );

    return duplicate; // Return updated record
  }

  return null; // No duplicate found, proceed with normal create
}

// Helper function to get nested data from inputData
function getNestedData(inputData, path) {
  let current = inputData;
  for (const key of path) {
    if (current[key] === undefined) return null;
    current = current[key];
  }
  return Array.isArray(current) ? current : null;
}