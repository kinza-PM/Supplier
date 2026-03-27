import { DynamoDBClient, QueryCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, logError } from "../helper/helper.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);

    try {
        console.log("Get All Suppliers Request:", JSON.stringify(event, null, 2));

        const queryParams = event.queryStringParameters || {};
        const { status, category, type, limit, lastEvaluatedKey, all, includeDeleted } = queryParams;

        let command;

        if (all === 'true') {
            const scanParams = {
                TableName: process.env.SUPPLIERS_TABLE,
                Limit: limit ? parseInt(limit) : 50,
                ...(lastEvaluatedKey && {
                    ExclusiveStartKey: JSON.parse(
                        Buffer.from(lastEvaluatedKey, 'base64').toString('utf-8')
                    )
                })
            };

            // Exclude soft-deleted suppliers by default
            if (includeDeleted !== 'true') {
                scanParams.FilterExpression = '#status <> :deleted';
                scanParams.ExpressionAttributeNames = { '#status': 'status' };
                scanParams.ExpressionAttributeValues = { ':deleted': { S: 'Deleted' } };
            }

            command = new ScanCommand(scanParams);
        } else {
            let commandParams = {
                TableName: process.env.SUPPLIERS_TABLE,
                Limit: limit ? parseInt(limit) : 50
            };

            if (lastEvaluatedKey) {
                try {
                    commandParams.ExclusiveStartKey = JSON.parse(
                        Buffer.from(lastEvaluatedKey, 'base64').toString('utf-8')
                    );
                } catch (error) {
                    return createResponse(400, {
                        success: false,
                        message: "Invalid pagination token"
                    });
                }
            }

            if (status) {
                commandParams.IndexName = 'StatusIndex';
                commandParams.KeyConditionExpression = '#status = :status';
                commandParams.ExpressionAttributeNames = { '#status': 'status' };
                commandParams.ExpressionAttributeValues = { ':status': { S: status } };
                commandParams.ScanIndexForward = false;
                
                command = new QueryCommand(commandParams);
            } else if (category) {
                commandParams.IndexName = 'CategoryIndex';
                commandParams.KeyConditionExpression = 'category = :category';
                commandParams.ExpressionAttributeValues = { ':category': { S: category } };
                commandParams.ScanIndexForward = false;
                
                command = new QueryCommand(commandParams);
            } else if (type) {
                commandParams.IndexName = 'TypeIndex';
                commandParams.KeyConditionExpression = '#type = :type';
                commandParams.ExpressionAttributeNames = { '#type': 'type' };
                commandParams.ExpressionAttributeValues = { ':type': { S: type } };
                commandParams.ScanIndexForward = false;
                
                command = new QueryCommand(commandParams);
            } else {
                // Exclude soft-deleted suppliers by default for scan
                if (includeDeleted !== 'true') {
                    commandParams.FilterExpression = '#status <> :deleted';
                    commandParams.ExpressionAttributeNames = { '#status': 'status' };
                    commandParams.ExpressionAttributeValues = { ':deleted': { S: 'Deleted' } };
                }
                
                command = new ScanCommand(commandParams);
            }
        }

        const result = await dynamo.send(command);

        const suppliers = result.Items.map(item => {
            const supplier = {
                supplierId: item.supplierId.S,
                name: item.name.S,
                code: item.code.S,
                category: item.category.S,
                type: item.type.S,
                currency: item.currency?.S || '',
                contactPerson: item.contactPerson.S,
                email: item.email.S,
                contact: {
                    countryCode: item.countryCode.S,
                    number: item.phoneNumber.S
                },
                address: item.address?.S || '',
                city: item.city?.S || '',
                country: item.country?.S || '',
                documents: JSON.parse(item.documents.S),
                status: item.status.S,
                apiStatus: item.apiStatus.S,
                createdAt: item.createdAt.S,
                updatedAt: item.updatedAt.S
            };

            // Add soft delete metadata if present
            if (item.deletedAt?.S) {
                supplier.deletedAt = item.deletedAt.S;
            }
            if (item.deletedBy?.S) {
                supplier.deletedBy = item.deletedBy.S;
            }

            return supplier;
        });

        let nextToken = null;
        if (result.LastEvaluatedKey) {
            nextToken = Buffer.from(
                JSON.stringify(result.LastEvaluatedKey)
            ).toString('base64');
        }

        return createResponse(200, {
            success: true,
            message: "Suppliers retrieved successfully",
            data: {
                suppliers,
                count: suppliers.length,
                nextToken
            }
        });

    } catch (error) {
        console.error("Error getting suppliers:", error);

        await logError(error, {
            function: 'getAllSuppliers',
            event: JSON.stringify(event)
        });

        return createResponse(500, {
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};
