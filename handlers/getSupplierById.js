import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, logError } from "../helper/helper.js";
import { getSupplierHistory } from "../lib/historyLogger.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);
    let supplierId = null;

    try {
        console.log("Get Supplier By ID Request:", JSON.stringify(event, null, 2));

        supplierId = event.pathParameters?.supplierId;
        if (!supplierId) {
            return createResponse(400, {
                success: false,
                message: "Supplier ID is required"
            });
        }

        const queryParams = event.queryStringParameters || {};
        const includeHistory = queryParams.includeHistory === 'true';

        const getCmd = new GetItemCommand({
            TableName: process.env.SUPPLIERS_TABLE,
            Key: { supplierId: { S: supplierId } }
        });

        const result = await dynamo.send(getCmd);

        if (!result.Item) {
            return createResponse(404, {
                success: false,
                message: "Supplier not found"
            });
        }

        const supplier = {
            supplierId: result.Item.supplierId.S,
            name: result.Item.name.S,
            code: result.Item.code.S,
            category: result.Item.category.S,
            type: result.Item.type.S,
            contactPerson: result.Item.contactPerson.S,
            email: result.Item.email.S,
            contact: {
                countryCode: result.Item.countryCode.S,
                number: result.Item.phoneNumber.S
            },
            address: result.Item.address?.S || '',
            city: result.Item.city?.S || '',
            country: result.Item.country?.S || '',
            documents: JSON.parse(result.Item.documents.S),
            status: result.Item.status.S,
            apiStatus: result.Item.apiStatus.S,
            createdAt: result.Item.createdAt.S,
            updatedAt: result.Item.updatedAt.S
        };

        // Add soft delete metadata if present
        if (result.Item.deletedAt?.S) {
            supplier.deletedAt = result.Item.deletedAt.S;
        }
        if (result.Item.deletedBy?.S) {
            supplier.deletedBy = result.Item.deletedBy.S;
        }

        // Add optional configuration fields if present
        if (result.Item.flightMapping?.S) {
            supplier.flightMapping = JSON.parse(result.Item.flightMapping.S);
        }
        if (result.Item.hotelMapping?.S) {
            supplier.hotelMapping = JSON.parse(result.Item.hotelMapping.S);
        }
        if (result.Item.apiConnectivity?.S) {
            supplier.apiConnectivity = JSON.parse(result.Item.apiConnectivity.S);
        }
        if (result.Item.financeSetup?.S) {
            supplier.financeSetup = JSON.parse(result.Item.financeSetup.S);
        }

        let history = null;
        if (includeHistory) {
            history = await getSupplierHistory(supplierId);
        }

        return createResponse(200, {
            success: true,
            message: "Supplier retrieved successfully",
            data: {
                supplier,
                ...(history && { history })
            }
        });

    } catch (error) {
        console.error("Error getting supplier:", error);

        await logError(error, {
            function: 'getSupplierById',
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
