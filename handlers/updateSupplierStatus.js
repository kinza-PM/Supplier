import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, logError } from "../helper/helper.js";
import { logSupplierHistory } from "../lib/historyLogger.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

const VALID_STATUSES = ['Active', 'In-Active', 'Suspended', 'Blacklisted'];

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);
    let supplierId = null;

    try {
        console.log("Update Supplier Status Request:", JSON.stringify(event, null, 2));

        supplierId = event.pathParameters?.supplierId;
        if (!supplierId) {
            return createResponse(400, {
                success: false,
                message: "Supplier ID is required"
            });
        }

        const userId = event.headers?.user_id || 'unknown';
        const userType = event.headers?.user_type || 'unknown';

        let body;
        try {
            body = JSON.parse(event.body || '{}');
        } catch (error) {
            return createResponse(400, {
                success: false,
                message: "Invalid JSON in request body"
            });
        }

        const { status } = body;

        if (!status) {
            return createResponse(400, {
                success: false,
                message: "Status is required"
            });
        }

        if (!VALID_STATUSES.includes(status)) {
            return createResponse(422, {
                success: false,
                message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`
            });
        }

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

        const oldStatus = existingSupplier.Item.status.S;

        if (oldStatus === status) {
            return createResponse(200, {
                success: true,
                message: "Supplier status is already set to this value",
                data: {
                    supplierId,
                    status
                }
            });
        }

        const timestamp = new Date().toISOString();

        const updateCmd = new UpdateItemCommand({
            TableName: process.env.SUPPLIERS_TABLE,
            Key: { supplierId: { S: supplierId } },
            UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
            ExpressionAttributeNames: {
                "#status": "status"
            },
            ExpressionAttributeValues: {
                ":status": { S: status },
                ":updatedAt": { S: timestamp }
            },
            ReturnValues: "ALL_NEW"
        });

        const result = await dynamo.send(updateCmd);

        await logSupplierHistory(
            supplierId,
            'STATUS_CHANGED',
            {
                from: oldStatus,
                to: status
            },
            userId,
            userType
        );

        return createResponse(200, {
            success: true,
            message: `Supplier status updated to ${status}`,
            data: {
                supplierId,
                status: result.Attributes.status.S,
                previousStatus: oldStatus,
                updatedAt: result.Attributes.updatedAt.S
            }
        });

    } catch (error) {
        console.error("Error updating supplier status:", error);

        await logError(error, {
            function: 'updateSupplierStatus',
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
