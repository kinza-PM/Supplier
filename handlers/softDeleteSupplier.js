import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, logError } from "../helper/helper.js";
import { logSupplierHistory } from "../lib/historyLogger.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);
    let supplierId = null;

    try {
        console.log("Soft Delete Supplier Request:", JSON.stringify(event, null, 2));

        supplierId = event.pathParameters?.supplierId;
        if (!supplierId) {
            return createResponse(400, {
                success: false,
                message: "Supplier ID is required"
            });
        }

        const userId = event.headers?.user_id || 'unknown';
        const userType = event.headers?.user_type || 'unknown';

        const getCmd = new GetItemCommand({
            TableName: process.env.SUPPLIERS_TABLE,
            Key: { supplierId: { S: supplierId } }
        });

        const existingSupplier = await dynamo.send(getCmd);
        if (!existingSupplier.Item) {
            return createResponse(404, {
                success: false,
                message: "Supplier not found"
            });
        }

        if (existingSupplier.Item.status?.S === 'Deleted') {
            return createResponse(400, {
                success: false,
                message: "Supplier is already deleted"
            });
        }

        const supplierDataBefore = {
            supplierId: existingSupplier.Item.supplierId.S,
            name: existingSupplier.Item.name.S,
            code: existingSupplier.Item.code.S,
            category: existingSupplier.Item.category.S,
            type: existingSupplier.Item.type.S,
            status: existingSupplier.Item.status.S
        };

        const deletedAt = new Date().toISOString();

        const updateCmd = new UpdateItemCommand({
            TableName: process.env.SUPPLIERS_TABLE,
            Key: { supplierId: { S: supplierId } },
            UpdateExpression: "SET #status = :deleted, deletedAt = :timestamp, deletedBy = :userId, updatedAt = :updatedAt",
            ExpressionAttributeNames: {
                "#status": "status"
            },
            ExpressionAttributeValues: {
                ":deleted": { S: "Deleted" },
                ":timestamp": { S: deletedAt },
                ":userId": { S: userId },
                ":updatedAt": { S: deletedAt }
            },
            ReturnValues: "ALL_NEW"
        });

        const result = await dynamo.send(updateCmd);

        await logSupplierHistory(
            supplierId,
            'SUPPLIER_SOFT_DELETED',
            {
                before: supplierDataBefore,
                after: {
                    status: 'Deleted',
                    deletedAt,
                    deletedBy: userId
                }
            },
            userId,
            userType
        );

        return createResponse(200, {
            success: true,
            message: "Supplier soft deleted successfully",
            data: {
                supplierId,
                status: "Deleted",
                deletedAt,
                deletedBy: userId
            }
        });

    } catch (error) {
        console.error("Error soft deleting supplier:", error);

        await logError(error, {
            function: 'softDeleteSupplier',
            supplierId,
            event: JSON.stringify(event)
        });

        return createResponse(500, {
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};
