import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, logError } from "../helper/helper.js";
import { logSupplierHistory } from "../lib/historyLogger.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

const VALID_API_STATUSES = ['Active', 'In-Active'];

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);
    let supplierId = null;

    try {
        console.log("Toggle Supplier API Status Request:", JSON.stringify(event, null, 2));

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

        const { apiStatus } = body;

        if (!apiStatus) {
            return createResponse(400, {
                success: false,
                message: "apiStatus is required"
            });
        }

        if (!VALID_API_STATUSES.includes(apiStatus)) {
            return createResponse(422, {
                success: false,
                message: `Invalid API status. Must be one of: ${VALID_API_STATUSES.join(', ')}`
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

        const oldApiStatus = existingSupplier.Item.apiStatus.S;

        if (oldApiStatus === apiStatus) {
            return createResponse(200, {
                success: true,
                message: "Supplier API status is already set to this value",
                data: {
                    supplierId,
                    apiStatus
                }
            });
        }

        const timestamp = new Date().toISOString();

        const updateCmd = new UpdateItemCommand({
            TableName: process.env.SUPPLIERS_TABLE,
            Key: { supplierId: { S: supplierId } },
            UpdateExpression: "SET apiStatus = :apiStatus, updatedAt = :updatedAt",
            ExpressionAttributeValues: {
                ":apiStatus": { S: apiStatus },
                ":updatedAt": { S: timestamp }
            },
            ReturnValues: "ALL_NEW"
        });

        const result = await dynamo.send(updateCmd);

        await logSupplierHistory(
            supplierId,
            'API_STATUS_CHANGED',
            {
                from: oldApiStatus,
                to: apiStatus
            },
            userId,
            userType
        );

        return createResponse(200, {
            success: true,
            message: `Supplier API status updated to ${apiStatus}`,
            data: {
                supplierId,
                apiStatus: result.Attributes.apiStatus.S,
                previousApiStatus: oldApiStatus,
                updatedAt: result.Attributes.updatedAt.S
            }
        });

    } catch (error) {
        console.error("Error toggling supplier API status:", error);

        await logError(error, {
            function: 'toggleSupplierApiStatus',
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
