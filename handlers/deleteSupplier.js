import { DynamoDBClient, GetItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createResponse, setRequestContext, logError } from "../helper/helper.js";
import { logSupplierHistory } from "../lib/historyLogger.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });
const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);
    let supplierId = null;

    try {
        console.log("Delete Supplier Request:", JSON.stringify(event, null, 2));

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

        try {
            const documents = JSON.parse(existingSupplier.Item.documents.S);
            
            if (documents && documents.length > 0) {
                for (const document of documents) {
                    const deleteCmd = new DeleteObjectCommand({
                        Bucket: process.env.DOCUMENTS_BUCKET,
                        Key: document.key
                    });
                    await s3Client.send(deleteCmd);
                }
            }
        } catch (error) {
            console.error("Error deleting documents:", error);
        }

        const supplierData = {
            supplierId: existingSupplier.Item.supplierId.S,
            name: existingSupplier.Item.name.S,
            code: existingSupplier.Item.code.S,
            category: existingSupplier.Item.category.S,
            type: existingSupplier.Item.type.S,
            status: existingSupplier.Item.status.S
        };

        const deleteCmd = new DeleteItemCommand({
            TableName: process.env.SUPPLIERS_TABLE,
            Key: { supplierId: { S: supplierId } }
        });

        await dynamo.send(deleteCmd);

        await logSupplierHistory(
            supplierId,
            'SUPPLIER_DELETED',
            supplierData,
            userId,
            userType
        );

        return createResponse(200, {
            success: true,
            message: "Supplier deleted successfully",
            data: {
                supplierId,
                deletedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error("Error deleting supplier:", error);

        await logError(error, {
            function: 'deleteSupplier',
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
