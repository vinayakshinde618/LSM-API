const { getSchemaModels } = require('../commanFunctions/schemaModels.controller');
const { Op } = require('sequelize');

async function getRecord(params) {
    try {
        const { modelName, schema, relations, include, whereCondition, moduleWhereCondition, subModuleWhereCondition, isHighlyNestedInclude, subSubModuleWhereCondition, search, pagination, orderBy, order, subQuery = false, raw = false, nest = true } = params;

        const Model = getSchemaModels(schema);

        // Build the where condition using the common function
        const sequelizeWhereCondition = whereCondition ? await buildWhereCondition(whereCondition) : null;

        // Pagination
        const { limit, offset } = pagination ? await getPagination(pagination) : { limit: 10000, offset: 0 };

        // Search functionality
        const searchCondition = search ? await getSearchCondition(search, [], Model) : null;

        // Handle includes - priority to new 'include' parameter, fallback to 'relations'
        let relationIncludes = [];
        if (include) {
            relationIncludes = await processIncludes(include, Model);
        } else if (relations) {
            relationIncludes = await getRelationIncludes(
                relations,
                moduleWhereCondition,
                subModuleWhereCondition,
                subSubModuleWhereCondition,
                Model
            );
        }

        // Relations include
        // const relationIncludes = relations ? await getRelationIncludes(relations, moduleWhereCondition, subModuleWhereCondition, subSubModuleWhereCondition) : [];

        // Order by field and order
        const orderByFieldName = orderBy?.field || 'id';  // Default to 'id'
        const orderByOrder = orderBy?.order || 'DESC';    // Default to 'DESC'
        const orderByModelName = orderBy?.model || modelName;
        const orderByModel = Model[orderByModelName];

        // Build the final order array
        let orderClause = [];

        if (order) {
            orderClause = order
        }
        else {
            if (orderByModelName === modelName) {
                // Order by parent model field
                orderClause = [[orderByFieldName, orderByOrder]];
            } else {
                // Order by included/child model field
                orderClause = [[{ model: orderByModel }, orderByFieldName, orderByOrder]];
            }
        }

        let result;

        if (isHighlyNestedInclude) {
            // Step 1: Count total parents (without includes)
            const totalCount = await Model[modelName].count({
                where: {
                    [Op.and]: [sequelizeWhereCondition, searchCondition]
                },
            });

            // Step 2: Fetch only parent IDs with pagination
            const parentIds = await Model[modelName].findAll({
                attributes: ['id'], // only fetch IDs
                where: {
                    [Op.and]: [sequelizeWhereCondition, searchCondition]
                },
                order: orderClause,
                offset,
                limit,
                schema: params.schema,
                raw: true
            });

            // If no parents found, return empty response
            if (!parentIds.length) {
                return { count: totalCount, rows: [] };
            }

            // Step 3: Fetch full parents + includes
            let rows = await Model[modelName].findAll({
                where: { id: parentIds.map(p => p.id) },
                attributes: params.attributes || undefined,
                order: orderClause,
                include: relationIncludes,
                schema: params.schema,
                raw: raw,
                nest: nest,
                hooks: params.hook || false
            });

            // Convert to JSON if needed
            rows = rows.map(row => row.toJSON());

            // Final Response (same as `findAndCountAll`)
            result = {
                count: totalCount,
                rows
            };
        }
        else {
            // Fetching records with pagination, search, and conditions
            result = await Model[modelName].findAndCountAll({ // here i want to fetch the table from that specific schema, my schema will be dynamic
                where: {
                    [Op.and]: [sequelizeWhereCondition, searchCondition]
                },
                attributes: params.attributes || undefined, // Only include if provided
                order: orderClause,
                include: relationIncludes,
                offset,
                limit,
                subQuery: subQuery,
                hook: params.hook || false,
                distinct: true, // Important when counting with joins
                raw: raw,
                nest: nest,
                customData: params
            });

            result.rows = result.rows.map(row => row.toJSON());
        }

        return result;
    } catch (error) {
        console.warn('Get pagination function error:', error.message);
        throw error;
    }
}

const buildWhereCondition = (condition) => {
    try {
        const { Op, fn, col, where } = require('sequelize');

        if (!condition) {
            return null;
        }
        const whereClause = {};

        for (const key in condition) {
            if (condition.hasOwnProperty(key)) {
                const value = condition[key];

                // ✅ Handle Sequelize logical operators (Op.or, Op.and)
                if (key === 'Op.or' || key === 'Op.and') {
                    whereClause[Op[key.split('.')[1]]] = value.map(v => buildWhereCondition(v));
                    continue;
                }

                // ✅ Skip empty string values
                if (value === '') continue;

                const isDateField = key.toLowerCase().includes('date') || key.toLowerCase().endsWith('_at') || key.toLowerCase() === 'scheduled_start';

                if (typeof value === 'object' && value !== null) {
                    // Handle complex operators
                    if (value.in) {
                        whereClause[key] = { [Op.in]: value.in };
                    }
                    if (value.notIn) {
                        whereClause[key] = { [Op.notIn]: value.notIn };
                    }
                    if (value.like) {
                        whereClause[key] = { [Op.like]: `%${value.like}%` }; // SQL LIKE operator
                    }
                    if (value.gt) {
                        whereClause[key] = { [Op.gt]: value.gt }; // Greater than
                    }
                    if (value.lt) {
                        whereClause[key] = { [Op.lt]: value.lt }; // Less than
                    }
                    if (value.gte) {
                        whereClause[key] = { [Op.gte]: value.gte }; // Greater than or equal
                    }
                    if (value.lte) {
                        whereClause[key] = { [Op.lte]: value.lte }; // Less than or equal
                    }
                    // ✅ ADD THIS FOR BETWEEN OPERATOR
                    if (value.between) {
                        whereClause[key] = { [Op.between]: value.between };
                    }
                    // ✅ ADD THIS FOR NOT EQUAL OPERATOR
                    if (value.ne) {
                        whereClause[key] = { [Op.ne]: value.ne }; // Not equal
                    }
                    // ✅ ADD THIS FOR IS NULL OPERATOR
                    if (value.isNull) {
                        whereClause[key] = { [Op.is]: null }; // Is null
                    }
                    // ✅ ADD THIS FOR NOT NULL OPERATOR
                    if (value.notNull) {
                        whereClause[key] = { [Op.ne]: null }; // Not null
                    }
                }
                else if (isDateField && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
                    // Handle date-only exact match
                    whereClause[key] = where(fn('date', col(key)), '=', value);
                }
                else {
                    // Simple equality condition
                    whereClause[key] = value;
                }
            }
        }
        return whereClause;
    } catch (error) {
        console.error('Build where condition function error:', error);
        return null;
    }
}
// Common function for search condition
// const getSearchCondition = (search, includeModels = [], Model) => {
//     if (search && search.field_name && search.field_name.length > 0 && search.searchKeyword && search.searchKeyword.trim().length > 0) {
//         const conditions = search.field_name.map(fieldName => {
//             const [modelAlias, column] = fieldName.split('.');

//             if (column) {
//                 // Handle association fields
//                 return getAssociationSearchCondition(modelAlias, column, search.searchKeyword, includeModels, Model);
//             }

//             // Handle simple fields (no dot notation)
//             return getBasicSearchCondition(fieldName, search.searchKeyword);
//         });

//         return {
//             [Op.or]: conditions
//         };
//     }
//     return null;
// };

const getSearchCondition = (search, includeModels = [], Model) => {
    const { Op } = Model.Sequelize;

    if (
        search &&
        search.field_name &&
        search.field_name.length > 0 &&
        search.searchKeyword &&
        search.searchKeyword.trim().length > 0
    ) {
        const conditions = search.field_name.map(fieldName => {
            const parts = fieldName.split('.');

            // Case 1: Simple field (no association)
            if (parts.length === 1) {
                return getBasicSearchCondition(parts[0], search.searchKeyword);
            }

            // Case 2: Direct association (modelAlias.column)
            if (parts.length === 2) {
                const [modelAlias, column] = parts;
                return getAssociationSearchCondition(modelAlias, column, search.searchKeyword, includeModels, Model);
            }

            // Case 3: Nested association (e.g., a.b.c or deeper)
            if (parts.length > 2) {
                return getDeepAssociationSearchCondition(parts, search.searchKeyword, includeModels, Model);
            }

            return null;
        });

        return { [Op.or]: conditions.filter(Boolean) };
    }
    return null;
};

// 🆕 New: Handle infinite nested associations
const getDeepAssociationSearchCondition = (parts, searchKeyword, includeModels, Model) => {
    const { Op, literal, where, fn } = Model.Sequelize;

    // Example: ['item', 'uom', 'name']
    const column = parts.pop(); // last part = column name
    const pathParts = []; // build proper alias like "item->uom"

    // Sequelize uses `->` to separate deep includes in aliases
    parts.forEach((part, i) => {
        if (i === 0) pathParts.push(part);
        else pathParts.push(`->${part}`);
    });

    const path = pathParts.join(''); // "item->uom"
    const fieldPath = `"${path}"."${column}"`;

    // Safe casting to TEXT for flexible ILIKE search
    return where(
        fn('CAST', literal(`${fieldPath} AS TEXT`)),
        { [Op.iLike]: `%${searchKeyword}%` }
    );
};


const getAssociationSearchCondition = (modelAlias, column, searchKeyword, includeModels, Model) => {
    const { Op, fn, col, where, literal } = Model.Sequelize;

    const isNumericField = ['mobile_number', 'phone', 'id'].some(term =>
        column.toLowerCase().includes(term)
    );

    const isDateField = column.toLowerCase().includes('date') ||
        column.includes('_at') || column.endsWith('At');

    const isValidDate = (dateStr) => {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(dateStr)) return false;
        const date = new Date(dateStr);
        return !isNaN(date.getTime());
    };

    if (isNumericField) {
        // Cast numeric column to text and search
        return where(
            fn('CAST', literal(`"${modelAlias}"."${column}" AS TEXT`)),
            {
                [Op.iLike]: `%${searchKeyword}%`
            }
        );
    } else if (isDateField) {
        if (isValidDate(searchKeyword)) {
            // Exact match on date
            return where(
                fn('DATE', literal(`"${modelAlias}"."${column}"`)),
                searchKeyword
            );
        } else {
            // Fallback to text-based search
            return where(
                fn('CAST', literal(`"${modelAlias}"."${column}" AS TEXT`)),
                {
                    [Op.iLike]: `%${searchKeyword}%`
                }
            );
        }
    } else {
        // Default: string-based fuzzy match
        return where(
            literal(`"${modelAlias}"."${column}"`),
            {
                [Op.iLike]: `%${searchKeyword}%`
            }
        );
    }
};

// const getBasicSearchCondition = (fieldName, searchKeyword) => {
//     return { [fieldName]: { [Op.iLike]: `%${searchKeyword}%` } };
// };

const getBasicSearchCondition1 = (fieldName, searchKeyword) => {
    const { Op, fn, col, where } = require('sequelize');

    // Identify numeric fields (like mobile_number)
    const isNumericField = ['mobile_number', 'phone', 'id'].some(term =>
        fieldName.toLowerCase().includes(term)
    );

    // If the field name indicates it's a date field (common patterns)
    const isDateField = fieldName.includes('date') || fieldName.includes('Date') || fieldName.includes('_at') || fieldName.endsWith('At');

    // Check if it's a valid yyyy-mm-dd date string
    const isValidDate = (dateStr) => {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(dateStr)) return false;
        const date = new Date(dateStr);
        return !isNaN(date.getTime());
    };


    if (isNumericField) {
        // Handle numeric fields differently - cast to text for search
        return where(
            fn('CAST', col(fieldName), 'AS TEXT'),
            { [Op.iLike]: `%${searchKeyword}%` }
        );
    }

    if (!isDateField) {
        // Default case for non-date fields
        return { [fieldName]: { [Op.iLike]: `%${searchKeyword}%` } };
    }

    if (isDateField && isValidDate(searchKeyword) && searchKeyword) {
        return {
            [fieldName]: where(
                fn('date', col(fieldName)),
                '=',
                searchKeyword
            )
        };
    }
};

const getBasicSearchCondition = (fieldName, searchKeyword) => {
    const { Op, fn, col, where, literal } = require('sequelize');

    const isNumericField = ['mobile_number', 'phone', 'id', 'sequence_no'].some(term =>
        fieldName.toLowerCase().includes(term)
    );

    const isDateField = fieldName.includes('date') || fieldName.includes('Date') ||
        fieldName.includes('_at') || fieldName.endsWith('At');

    const isValidDate = (dateStr) => {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(dateStr)) return false;
        const date = new Date(dateStr);
        return !isNaN(date.getTime());
    };

    if (isNumericField) {
        // Use literal for correct casting
        return where(
            fn('CAST', literal(`${fieldName} AS TEXT`)),
            { [Op.iLike]: `%${searchKeyword}%` }
        );
    }
    else if (isDateField) {
        if (isValidDate(searchKeyword)) {
            return {
                [fieldName]: where(
                    fn('date', col(fieldName)),
                    '=',
                    searchKeyword
                )
            };
        } else {
            // For invalid dates or empty search, cast to text and do a text search
            // return where(
            //     fn('CAST', literal(`${fieldName} AS TEXT`)),
            //     { [Op.iLike]: `%${searchKeyword}%` }
            // );
        }
    }
    else {
        return { [fieldName]: { [Op.iLike]: `%${searchKeyword}%` } };
    }
};


// Common function for pagination
const getPagination = (pagination) => {
    try {
        let pageSize = 10; // default page size
        let offset = 0; // default offset

        if (pagination && pagination.page && pagination.pageSize) {
            const page = pagination.page; // Get the page number
            pageSize = pagination.pageSize; // Get the page size
            offset = (page - 1) * pageSize;
        }

        return { limit: pageSize, offset };
    } catch (error) {
        console.error('Get pagination function error:', error);
        return null;
    }
};

const getRelationIncludes = (relations, moduleWhereCondition, subModuleWhereCondition, subSubModuleWhereCondition, Model) => {
    try {
        if (!relations || !Array.isArray(relations) || relations.length === 0) {
            console.warn("No relations provided or invalid array");  // Log a warning message
            return [];  // Return an empty array to avoid processing
        }

        const includeVar = relations.map((item) => {
            if (!item.module || !item.moduleAs) {
                console.warn("Missing required 'module' or 'moduleAs' in relation item");
                return null;  // Skip this item if it's invalid
            }

            var subIncludeVar = [];
            var subSubIncludeVar = [];
            if (item.subSubModule) {
                let subSubWhereClause = item.isSubSubModuleWhereConditionRequired ? buildWhereCondition(subSubModuleWhereCondition) : null;
                subSubIncludeVar.push({ model: Model[item.subSubModule], as: item.subSubModuleAs ?? item.subSubModule, required: item.required ? item.required : false, where: subSubWhereClause });
            }
            if (item.subModule) {
                let subWhereClause = item.isSubModuleWhereConditionRequired ? buildWhereCondition(subModuleWhereCondition) : null;
                subIncludeVar.push({ model: Model[item.subModule], as: item.subModuleAs, required: item.required ? item.required : false, include: subSubIncludeVar, where: subWhereClause });

                // Add the second submodule (subModule1 and subModuleAs1) if they exist
                if (item.subModule1 && item.subModuleAs1) {
                    subIncludeVar.push(
                        { model: Model[item.subModule1], as: item.subModuleAs1, required: item.required ? item.required : false, include: subSubIncludeVar, where: subWhereClause });
                }
            }

            let whereClause = item.isModuleWhereConditionRequired ? buildWhereCondition(moduleWhereCondition) : (item.whereCondition || {});
            return { model: Model[item.module], as: item.moduleAs, required: item.required ? item.required : false, include: subIncludeVar, where: whereClause }
        });
        return includeVar;
    } catch (error) {
        console.error('Get relation includes function error:', error);
        return null;
    }
}

async function processIncludes(includes, Model) {
    if (!includes || !Array.isArray(includes)) return [];

    const result = [];

    for (const includeItem of includes) {
        if (!includeItem?.model) {
            console.warn('Include item missing model property');
            continue;
        }

        // Process where condition
        const where = includeItem.where
            ? await buildWhereCondition(includeItem.where)
            : {};

        // Process nested includes recursively
        const nestedIncludes = includeItem?.include?.length
            ? await processIncludes(includeItem.include, Model)
            : [];

        // Build include object
        const includeObj = {
            model: Model[includeItem.model],
            as: includeItem.as || includeItem.model,
            required: Boolean(includeItem.required),
            attributes: includeItem.attributes || undefined,
            where,
            include: nestedIncludes
        };

        result.push(includeObj);
    }

    return result;
}

module.exports = { getRecord }
