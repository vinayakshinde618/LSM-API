const _ = require('lodash');

async function modifyResponse(payload, data, Models) {
    switch (payload.modifyResponse) {
        case 'addMenuAccessInfo':
            const { roleId } = payload;

            if (!roleId) {
                throw new Error('roleId is required in payload for addMenuAccessInfo');
            }

            // Get all menu access records for this role
            const menuAccessRecords = await Models.menu_access_masters.findAll({
                where: { role_id: roleId },
                raw: true
            });

            // Create a map of menu_id to access status
            const accessMap = new Map();
            menuAccessRecords.forEach(record => {
                accessMap.set(record.menu_id, record.access);
            });

            // Recursive function to add access info to menu tree
            const addAccessToMenuTree = (menu) => {
                // First process all children (depth-first)
                if (menu.childMenus && menu.childMenus.length > 0) {
                    menu.childMenus.forEach(child => addAccessToMenuTree(child));
                }

                // Set access for current menu
                menu.hasAccess = accessMap.get(menu.id) || false;
            };

            // Apply to all menus in data
            data.forEach(menu => addAccessToMenuTree(menu));
            break;
    }
}

module.exports = { modifyResponse }