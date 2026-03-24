import { DynamoDBClient, GetItemCommand, UpdateItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { createResponse, setRequestContext, sanitizeInput, logError, parseMultipartFormData, uploadDocument, isValidEmail, isValidPhoneNumber } from "../helper/helper.js";
import { logSupplierHistory } from "../lib/historyLogger.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

const VALID_CATEGORIES = ['Flight', 'Hotel', 'Insurance', 'Rent-a-Car'];
const VALID_TYPES = ['GDS', 'Aggregator', 'Direct Contract'];

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);
    let supplierId = null;

    try {
        console.log("Update Supplier Request:", JSON.stringify(event, null, 2));

        supplierId = event.pathParameters?.supplierId;
        if (!supplierId) {
            return createResponse(400, {
                success: false,
                message: "Supplier ID is required"
            });
        }

        const userId = event.headers?.user_id || 'unknown';
        const userType = event.headers?.user_type || 'unknown';

        let fields, files;
        try {
            const parsed = await parseMultipartFormData(event);
            fields = parsed.fields;
            files = parsed.files || [];
        } catch (error) {
            return createResponse(400, {
                success: false,
                message: "Invalid request body: " + error.message
            });
        }
        const body = fields;

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

        const updateExpressions = [];
        const expressionAttributeNames = {};
        const expressionAttributeValues = {};
        const changes = {};

        if (body.name) {
            updateExpressions.push("#name = :name");
            expressionAttributeNames["#name"] = "name";
            expressionAttributeValues[":name"] = { S: sanitizeInput(body.name) };
            changes.name = {
                from: existingSupplier.Item.name.S,
                to: sanitizeInput(body.name)
            };
        }

        if (body.code) {
            const codeQuery = await dynamo.send(new QueryCommand({
                TableName: process.env.SUPPLIERS_TABLE,
                IndexName: 'CodeIndex',
                KeyConditionExpression: "code = :code",
                ExpressionAttributeValues: { ":code": { S: body.code.toUpperCase() } },
                Limit: 1
            }));

            if (codeQuery.Items && codeQuery.Items.length > 0 && codeQuery.Items[0].supplierId.S !== supplierId) {
                return createResponse(409, {
                    success: false,
                    message: "Supplier code already exists"
                });
            }

            updateExpressions.push("code = :code");
            expressionAttributeValues[":code"] = { S: body.code.toUpperCase() };
            changes.code = {
                from: existingSupplier.Item.code.S,
                to: body.code.toUpperCase()
            };
        }

        if (body.category) {
            // Validate categories (can be comma-separated)
            const categories = body.category.split(',').map(c => c.trim());
            const invalidCategories = categories.filter(c => !VALID_CATEGORIES.includes(c));
            
            if (invalidCategories.length > 0) {
                return createResponse(422, {
                    success: false,
                    message: `Invalid category: ${invalidCategories.join(', ')}. Must be one of: ${VALID_CATEGORIES.join(', ')}`
                });
            }
            
            updateExpressions.push("category = :category");
            expressionAttributeValues[":category"] = { S: body.category };
            changes.category = {
                from: existingSupplier.Item.category.S,
                to: body.category
            };
        }

        if (body.type) {
            if (!VALID_TYPES.includes(body.type)) {
                return createResponse(422, {
                    success: false,
                    message: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`
                });
            }
            updateExpressions.push("#type = :type");
            expressionAttributeNames["#type"] = "type";
            expressionAttributeValues[":type"] = { S: body.type };
            changes.type = {
                from: existingSupplier.Item.type.S,
                to: body.type
            };
        }

        if (body.contactPerson) {
            updateExpressions.push("contactPerson = :contactPerson");
            expressionAttributeValues[":contactPerson"] = { S: sanitizeInput(body.contactPerson) };
            changes.contactPerson = {
                from: existingSupplier.Item.contactPerson.S,
                to: sanitizeInput(body.contactPerson)
            };
        }

        if (body.email) {
            if (!isValidEmail(body.email)) {
                return createResponse(422, {
                    success: false,
                    message: "Invalid email format"
                });
            }
            updateExpressions.push("email = :email");
            expressionAttributeValues[":email"] = { S: body.email.toLowerCase() };
            changes.email = {
                from: existingSupplier.Item.email.S,
                to: body.email.toLowerCase()
            };
        }

        if (body.contact) {
            if (!body.contact.countryCode || !body.contact.number) {
                return createResponse(422, {
                    success: false,
                    message: "Contact must include countryCode and number"
                });
            }

            if (!isValidPhoneNumber(body.contact.countryCode, body.contact.number)) {
                return createResponse(422, {
                    success: false,
                    message: "Invalid phone number format"
                });
            }

            updateExpressions.push("countryCode = :countryCode, phoneNumber = :phoneNumber");
            expressionAttributeValues[":countryCode"] = { S: body.contact.countryCode };
            expressionAttributeValues[":phoneNumber"] = { S: body.contact.number };
            changes.contact = {
                from: `${existingSupplier.Item.countryCode.S} ${existingSupplier.Item.phoneNumber.S}`,
                to: `${body.contact.countryCode} ${body.contact.number}`
            };
        }

        if (body.address !== undefined) {
            updateExpressions.push("address = :address");
            expressionAttributeValues[":address"] = { S: sanitizeInput(body.address) };
            changes.address = sanitizeInput(body.address);
        }

        if (body.city !== undefined) {
            updateExpressions.push("city = :city");
            expressionAttributeValues[":city"] = { S: sanitizeInput(body.city) };
            changes.city = sanitizeInput(body.city);
        }

        if (body.country !== undefined) {
            updateExpressions.push("country = :country");
            expressionAttributeValues[":country"] = { S: sanitizeInput(body.country) };
            changes.country = sanitizeInput(body.country);
        }

        if (body.flightMapping !== undefined) {
            updateExpressions.push("flightMapping = :flightMapping");
            expressionAttributeValues[":flightMapping"] = { S: JSON.stringify(body.flightMapping) };
            changes.flightMapping = body.flightMapping;
        }

        if (body.hotelMapping !== undefined) {
            updateExpressions.push("hotelMapping = :hotelMapping");
            expressionAttributeValues[":hotelMapping"] = { S: JSON.stringify(body.hotelMapping) };
            changes.hotelMapping = body.hotelMapping;
        }

        if (body.apiConnectivity !== undefined) {
            updateExpressions.push("apiConnectivity = :apiConnectivity");
            expressionAttributeValues[":apiConnectivity"] = { S: JSON.stringify(body.apiConnectivity) };
            changes.apiConnectivity = body.apiConnectivity;
        }

        if (body.financeSetup !== undefined) {
            updateExpressions.push("financeSetup = :financeSetup");
            expressionAttributeValues[":financeSetup"] = { S: JSON.stringify(body.financeSetup) };
            changes.financeSetup = body.financeSetup;
        }

        if (files && files.length > 0) {
            try {
                const existingDocuments = existingSupplier.Item.documents?.S 
                    ? JSON.parse(existingSupplier.Item.documents.S) 
                    : [];
                
                const newDocuments = [];
                for (const file of files) {
                    const uploaded = await uploadDocument(file, supplierId);
                    newDocuments.push(uploaded);
                }
                
                const allDocuments = [...existingDocuments, ...newDocuments];
                updateExpressions.push("documents = :documents");
                expressionAttributeValues[":documents"] = { S: JSON.stringify(allDocuments) };
                changes.documents = {
                    added: newDocuments.length,
                    total: allDocuments.length
                };
            } catch (error) {
                console.error("Document upload failed:", error);
                return createResponse(400, {
                    success: false,
                    message: `Document upload failed: ${error.message}`
                });
            }
        }

        if (updateExpressions.length === 0) {
            return createResponse(400, {
                success: false,
                message: "No valid fields to update"
            });
        }

        const timestamp = new Date().toISOString();
        updateExpressions.push("updatedAt = :updatedAt");
        expressionAttributeValues[":updatedAt"] = { S: timestamp };

        const updateCmd = new UpdateItemCommand({
            TableName: process.env.SUPPLIERS_TABLE,
            Key: { supplierId: { S: supplierId } },
            UpdateExpression: `SET ${updateExpressions.join(", ")}`,
            ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 
                ? expressionAttributeNames 
                : undefined,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: "ALL_NEW"
        });

        const result = await dynamo.send(updateCmd);

        await logSupplierHistory(
            supplierId,
            'SUPPLIER_UPDATED',
            changes,
            userId,
            userType
        );

        const updatedSupplier = {
            supplierId: result.Attributes.supplierId.S,
            name: result.Attributes.name.S,
            code: result.Attributes.code.S,
            category: result.Attributes.category.S,
            type: result.Attributes.type.S,
            contactPerson: result.Attributes.contactPerson.S,
            email: result.Attributes.email.S,
            contact: {
                countryCode: result.Attributes.countryCode.S,
                number: result.Attributes.phoneNumber.S
            },
            address: result.Attributes.address?.S || '',
            city: result.Attributes.city?.S || '',
            country: result.Attributes.country?.S || '',
            documents: JSON.parse(result.Attributes.documents.S),
            status: result.Attributes.status.S,
            apiStatus: result.Attributes.apiStatus.S,
            createdAt: result.Attributes.createdAt.S,
            updatedAt: result.Attributes.updatedAt.S
        };

        // Add optional configuration fields if present
        if (result.Attributes.flightMapping?.S) {
            updatedSupplier.flightMapping = JSON.parse(result.Attributes.flightMapping.S);
        }
        if (result.Attributes.hotelMapping?.S) {
            updatedSupplier.hotelMapping = JSON.parse(result.Attributes.hotelMapping.S);
        }
        if (result.Attributes.apiConnectivity?.S) {
            updatedSupplier.apiConnectivity = JSON.parse(result.Attributes.apiConnectivity.S);
        }
        if (result.Attributes.financeSetup?.S) {
            updatedSupplier.financeSetup = JSON.parse(result.Attributes.financeSetup.S);
        }

        return createResponse(200, {
            success: true,
            message: "Supplier updated successfully",
            data: updatedSupplier
        });

    } catch (error) {
        console.error("Error updating supplier:", error);

        await logError(error, {
            function: 'updateSupplier',
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
