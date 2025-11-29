const { Op } = require('sequelize');

// Export all functions as a module
module.exports = (models) => {
    // Helper functions that need models
    const getAssociationSearchCondition = (modelAlias, column, searchKeyword) => {
        return models.sequelize.where(
            models.sequelize.literal(`CAST("${modelAlias}"."${column}" AS TEXT)`),
            { [Op.iLike]: `%${searchKeyword}%` }
        );
    };

    const getBasicSearchCondition = (fieldName, searchKeyword) => {
        return { [fieldName]: { [Op.iLike]: `%${searchKeyword}%` } };
    };

    // Main exported functions
    const getSearchCondition = (search, includeModels = []) => {
        if (search && search.field_name && search.field_name.length > 0 &&
            search.searchKeyword && search.searchKeyword.trim().length > 0) {
            const conditions = search.field_name.map(fieldName => {
                const [modelAlias, column] = fieldName.split('.');
                return column ? getAssociationSearchCondition(modelAlias, column, search.searchKeyword)
                    : getBasicSearchCondition(fieldName, search.searchKeyword);
            });
            return { [Op.or]: conditions };
        }
        return null;
    };

    const getPagination = (pagination) => {
        try {
            let pageSize = 10;
            let offset = 0;
            if (pagination?.page && pagination?.pageSize) {
                pageSize = pagination.pageSize;
                offset = (pagination.page - 1) * pageSize;
            }
            return { limit: pageSize, offset };
        } catch (error) {
            console.error('Get pagination error:', error);
            return { limit: 10, offset: 0 };
        }
    };

    return {
        getSearchCondition,
        getPagination
    };
};