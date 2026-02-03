const { getSchemaModels } = require("../commanFunctions/schemaModels.controller");

exports.createOrUpdateMenuAccess = async (req, res, next) => {
    try {
        const { accessData, schema, userId } = req.body;

        if (!accessData || !schema || !userId) {
            return res.status(400).json({
                code: 0,
                success: false,
                message: "accessData, user id and schema are required"
            });
        }

        const now = new Date();

        const Models = getSchemaModels(schema);

        // Basic validation
        if (!accessData || !Array.isArray(accessData)) {
            return res.status(400).json({
                code: 0,
                success: false,
                message: "accessData must be an array"
            });
        }

        // Validate each item
        for (let i = 0; i < accessData.length; i++) {
            const item = accessData[i];
            if (!item.role_id || !item.menu_id || typeof item.hasAccess !== 'boolean') {
                return res.status(400).json({
                    code: 0,
                    success: false,
                    message: `Item at index ${i} is missing required fields (role_id, menu_id, hasAccess)`
                });
            }
        }

        // Process each item one by one
        let createdCount = 0;
        let updatedCount = 0;

        for (let i = 0; i < accessData.length; i++) {
            const { role_id, menu_id, hasAccess } = accessData[i];

            // Check if record exists
            const existingRecord = await Models.menu_access_masters.findOne({
                where: {
                    role_id: role_id,
                    menu_id: menu_id
                }
            });

            if (existingRecord) {
                // Update existing record
                existingRecord.access = hasAccess;
                existingRecord.updated_by = userId;
                await existingRecord.save();
                updatedCount++;
            } else {
                // Create new record
                await Models.menu_access_masters.create({
                    role_id: role_id,
                    menu_id: menu_id,
                    access: hasAccess,
                    created_by: userId,
                    updated_by: userId,
                    is_active: true
                });
                createdCount++;
            }
        }

        return res.status(200).json({
            code: 1,
            success: true,
            message: "Menu access permissions processed successfully",
            accessData: {
                created: createdCount,
                updated: updatedCount
            }
        });

    } catch (error) {
        console.error("Error in createOrUpdateMenuAccess:", error);
        next(error);
    }
};