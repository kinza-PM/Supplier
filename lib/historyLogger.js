import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from 'uuid';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

async function logSupplierHistory(supplierId, action, changes, userId, userType) {
    try {
        const historyId = uuidv4();
        const timestamp = new Date().toISOString();

        const putCmd = new PutItemCommand({
            TableName: process.env.SUPPLIER_HISTORY_TABLE,
            Item: {
                historyId: { S: historyId },
                supplierId: { S: supplierId },
                action: { S: action },
                changes: { S: JSON.stringify(changes) },
                userId: { S: userId || 'system' },
                userType: { S: userType || 'system' },
                timestamp: { S: timestamp }
            }
        });

        await dynamo.send(putCmd);
        return historyId;
    } catch (error) {
        console.error("Failed to log supplier history:", error);
        throw error;
    }
}

async function getSupplierHistory(supplierId) {
    try {
        
        const queryCmd = new QueryCommand({
            TableName: process.env.SUPPLIER_HISTORY_TABLE,
            IndexName: 'SupplierIdIndex',
            KeyConditionExpression: 'supplierId = :supplierId',
            ExpressionAttributeValues: {
                ':supplierId': { S: supplierId }
            },
            ScanIndexForward: false
        });

        const result = await dynamo.send(queryCmd);
        
        return result.Items.map(item => ({
            historyId: item.historyId.S,
            supplierId: item.supplierId.S,
            action: item.action.S,
            changes: JSON.parse(item.changes.S),
            userId: item.userId.S,
            userType: item.userType.S,
            timestamp: item.timestamp.S
        }));
    } catch (error) {
        console.error("Failed to get supplier history:", error);
        throw error;
    }
}

export {
    logSupplierHistory,
    getSupplierHistory
};
