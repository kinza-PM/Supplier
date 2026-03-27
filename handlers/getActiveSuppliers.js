import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, logError } from "../helper/helper.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);

    try {
        console.log("Get Active Suppliers Request:", JSON.stringify(event, null, 2));

        const queryParams = event.queryStringParameters || {};
        const { limit, lastEvaluatedKey, category, type } = queryParams;

        let commandParams = {
            TableName: process.env.SUPPLIERS_TABLE,
            IndexName: 'StatusIndex',
            KeyConditionExpression: '#status = :active',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':active': { S: 'Active' } },
            ScanIndexForward: false,
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

        // Add additional filters if provided
        if (category || type) {
            let filterExpressions = [];
            
            if (category) {
                filterExpressions.push('category = :category');
                commandParams.ExpressionAttributeValues[':category'] = { S: category };
            }
            
            if (type) {
                filterExpressions.push('#type = :type');
                commandParams.ExpressionAttributeNames['#type'] = 'type';
                commandParams.ExpressionAttributeValues[':type'] = { S: type };
            }
            
            if (filterExpressions.length > 0) {
                commandParams.FilterExpression = filterExpressions.join(' AND ');
            }
        }

        const command = new QueryCommand(commandParams);
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
            message: "Active suppliers retrieved successfully",
            data: {
                suppliers,
                count: suppliers.length,
                nextToken
            }
        });

    } catch (error) {
        console.error("Error getting active suppliers:", error);

        await logError(error, {
            function: 'getActiveSuppliers',
            event: JSON.stringify(event)
        });

        return createResponse(500, {
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};
