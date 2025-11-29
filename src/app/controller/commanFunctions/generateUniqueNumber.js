const moment = require("moment");
const { calculateFinancialYear } = require("calculate-financial-year");
const { Op } = require("sequelize");
const { getSchemaModels } = require('./../commanFunctions/schemaModels.controller');

// unique number generator
async function uniqueNumberFunction(schema_name, transactionId) {
    try {
        const Model = getSchemaModels('admin_config');

        // search organization using schema name.
        let organization = await Model.organizations.findOne({
            where: { schema_name: schema_name, is_active: "Active", },
        });

        if (!organization) {
            return null
        }

        const { id } = organization;
        let financialYearMasterId;
        let fyCode;

        const today = new Date();
        const currentDate = moment(today).format("YYYY-MM-DD");

        // check current FY exists
        let financialYearMasterData = await Model.fy_masters.findAll({
            where: {
                start_date: { [Op.lte]: currentDate },
                end_date: { [Op.gte]: currentDate },
                is_active: "Active",
            },
        });

        // find financial year and take reference id
        if (financialYearMasterData.length === 0) {
            // create new FY
            const financialYearOutput = calculateFinancialYear(new Date());
            fyCode = "20" + financialYearOutput;

            const startDate = moment(currentDate).format("YYYY") + "-04-01";
            const endDate =
                moment(currentDate).add(1, "year").format("YYYY") + "-03-31";

            const financialYearMasterCreate = {
                fy_code: fyCode,
                start_date: startDate,
                end_date: endDate,
                is_active: "Active",
            };

            const financialYeardInsert = await Model.fy_masters.create(financialYearMasterCreate);
            financialYearMasterId = financialYeardInsert.dataValues.id;
        } else {
            financialYearMasterId = financialYearMasterData[0].id;
            fyCode = financialYearMasterData[0].fy_code;
        }

        // check mapping in year_transaction_masters
        const yearTransactionMasterData = await Model.year_transaction_masters.findAll({ where: { organization_id: id, fy_master_id: financialYearMasterId }, });

        if (yearTransactionMasterData.length === 0) {
            // if no mapping then create from transaction_masters
            const transactionmasterResponse =
                await Model.transaction_masters.findAll({
                    where: { is_active: "Active" },
                });

            if (transactionmasterResponse.length > 0) {
                const yearTransactionMasterCreate = transactionmasterResponse.map(
                    (item) => ({
                        organization_id: id,
                        fy_master_id: financialYearMasterId,
                        transaction_id: item.id,
                        transaction_series:
                            item.transaction_name + "_" + fyCode.replace("-", ""),
                        is_active: "Active",
                        series_start_no: 1,
                    })
                );

                await Model.year_transaction_masters.bulkCreate(
                    yearTransactionMasterCreate
                );
            }
        }

        // now fetch specific transaction entry
        const yearTransactionMasterResponse = await Model.year_transaction_masters.findAll({ where: { organization_id: id, transaction_id: transactionId, fy_master_id: financialYearMasterId } });

        if (yearTransactionMasterResponse.length > 0) {
            const row = yearTransactionMasterResponse[0];
            const seriesStartNo = Number(row.series_start_no) + 1;

            const uniqueId = row.transaction_series + "_0" + seriesStartNo;

            // update series no
            await Model.year_transaction_masters.update(
                { series_start_no: seriesStartNo },
                { where: { id: row.id } }
            );

            return uniqueId;
        } else {
            // transaction not found → create fresh entry
            const transactionmasterResponse2 =
                await Model.transaction_masters.findAll({
                    where: { id: transactionId },
                });

            if (transactionmasterResponse2.length > 0) {
                const transactionMasterId = transactionmasterResponse2[0].id;
                const transactionSeries =
                    transactionmasterResponse2[0].transaction_name +
                    "_" +
                    fyCode.replace("-", "");
                const uniqueId = transactionSeries + "_01";

                const yearTransactionMasterCreate = {
                    organization_id: id,
                    fy_master_id: financialYearMasterId,
                    transactio_id: transactionMasterId,
                    transaction_series: transactionSeries,
                    series_start_no: 1,
                    is_active: "Active",
                };

                await Model.year_transaction_masters.create(
                    yearTransactionMasterCreate
                );

                return uniqueId;
            } else {
                return null;
            }
        }
    } catch (error) {
        console.error("Unique number function error:", error);
        return null;
    }
}

module.exports = { uniqueNumberFunction };
