import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { 
    createResponse, 
    setRequestContext,
    isValidEmail, 
    isValidPhoneNumber,
    generateSupplierId,
    sanitizeInput,
    logError,
    uploadDocument,
    parseMultipartFormData
} from "../helper/helper.js";
import { logSupplierHistory } from "../lib/historyLogger.js";

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-1" });

const VALID_CATEGORIES = ['Flight', 'Hotel', 'Insurance', 'Rent-a-Car'];
const VALID_TYPES = ['GDS', 'Aggregator', 'Direct Contract'];

export const handler = async (event, context) => {
    const startTime = Date.now();
    setRequestContext(event, context);
    let supplierId = null;

    try {
        console.log("Create Supplier Request:", JSON.stringify(event, null, 2));

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

        let { 
            name, 
            code, 
            category, 
            type, 
            contactPerson, 
            email, 
            contact,
            address,
            city,
            country,
            flightMapping,
            hotelMapping,
            apiConnectivity,
            financeSetup
        } = fields;

        // Parse JSON string fields from FormData
        if (typeof contact === 'string') contact = JSON.parse(contact);
        if (typeof flightMapping === 'string') flightMapping = JSON.parse(flightMapping);
        if (typeof hotelMapping === 'string') hotelMapping = JSON.parse(hotelMapping);
        if (typeof apiConnectivity === 'string') apiConnectivity = JSON.parse(apiConnectivity);
        if (typeof financeSetup === 'string') financeSetup = JSON.parse(financeSetup);

        if (!name || !code || !category || !type || !contactPerson || !email || !contact) {
            return createResponse(400, {
                success: false,
                message: "Missing required fields: name, code, category, type, contactPerson, email, contact"
            });
        }

        if (!isValidEmail(email)) {
            return createResponse(422, {
                success: false,
                message: "Invalid email format"
            });
        }

        if (!contact.countryCode || !contact.number) {
            return createResponse(422, {
                success: false,
                message: "Contact must include countryCode and number"
            });
        }

        if (!isValidPhoneNumber(contact.countryCode, contact.number)) {
            return createResponse(422, {
                success: false,
                message: "Invalid phone number format"
            });
        }

        // Validate categories (can be comma-separated)
        const categories = category.split(',').map(c => c.trim());
        const invalidCategories = categories.filter(c => !VALID_CATEGORIES.includes(c));
        
        if (invalidCategories.length > 0) {
            return createResponse(422, {
                success: false,
                message: `Invalid category: ${invalidCategories.join(', ')}. Must be one of: ${VALID_CATEGORIES.join(', ')}`
            });
        }

        if (!VALID_TYPES.includes(type)) {
            return createResponse(422, {
                success: false,
                message: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`
            });
        }

        const codeQuery = await dynamo.send(new QueryCommand({
            TableName: process.env.SUPPLIERS_TABLE,
            IndexName: 'CodeIndex',
            KeyConditionExpression: "code = :code",
            ExpressionAttributeValues: { ":code": { S: code.toUpperCase() } },
            Limit: 1
        }));

        if (codeQuery.Items && codeQuery.Items.length > 0) {
            return createResponse(409, {
                success: false,
                message: "Supplier code already exists"
            });
        }

        supplierId = generateSupplierId();
        const timestamp = new Date().toISOString();

        let uploadedDocuments = [];
        if (files && files.length > 0) {
            try {
                for (const file of files) {
                    const uploaded = await uploadDocument(file, supplierId);
                    uploadedDocuments.push(uploaded);
                }
            } catch (error) {
                console.error("Document upload failed:", error);
                return createResponse(400, {
                    success: false,
                    message: `Document upload failed: ${error.message}`
                });
            }
        }

        const supplierData = {
            supplierId: { S: supplierId },
            name: { S: sanitizeInput(name) },
            code: { S: code.toUpperCase() },
            category: { S: category },
            type: { S: type },
            contactPerson: { S: sanitizeInput(contactPerson) },
            email: { S: email.toLowerCase() },
            countryCode: { S: contact.countryCode },
            phoneNumber: { S: contact.number },
            address: { S: sanitizeInput(address || '') },
            city: { S: sanitizeInput(city || '') },
            country: { S: sanitizeInput(country || '') },
            documents: { S: JSON.stringify(uploadedDocuments) },
            status: { S: 'Active' },
            apiStatus: { S: 'Active' },
            createdAt: { S: timestamp },
            updatedAt: { S: timestamp }
        };

        // Add optional configuration fields
        if (flightMapping) {
            supplierData.flightMapping = { S: JSON.stringify(flightMapping) };
        }
        if (hotelMapping) {
            supplierData.hotelMapping = { S: JSON.stringify(hotelMapping) };
        }
        if (apiConnectivity) {
            supplierData.apiConnectivity = { S: JSON.stringify(apiConnectivity) };
        }
        if (financeSetup) {
            supplierData.financeSetup = { S: JSON.stringify(financeSetup) };
        }

        const putCmd = new PutItemCommand({
            TableName: process.env.SUPPLIERS_TABLE,
            Item: supplierData,
            ConditionExpression: "attribute_not_exists(supplierId)"
        });

        await dynamo.send(putCmd);

        await logSupplierHistory(
            supplierId,
            'SUPPLIER_CREATED',
            {
                name: sanitizeInput(name),
                code: code.toUpperCase(),
                category,
                type,
                status: 'Active',
                apiStatus: 'Active',
                documentCount: uploadedDocuments.length
            },
            userId,
            userType
        );

        const responseData = {
            supplierId,
            name: sanitizeInput(name),
            code: code.toUpperCase(),
            category,
            type,
            contactPerson: sanitizeInput(contactPerson),
            email: email.toLowerCase(),
            contact: {
                countryCode: contact.countryCode,
                number: contact.number
            },
            address: sanitizeInput(address || ''),
            city: sanitizeInput(city || ''),
            country: sanitizeInput(country || ''),
            documents: uploadedDocuments,
            status: 'Active',
            apiStatus: 'Active',
            createdAt: timestamp
        };

        // Add optional fields to response
        if (flightMapping) responseData.flightMapping = flightMapping;
        if (hotelMapping) responseData.hotelMapping = hotelMapping;
        if (apiConnectivity) responseData.apiConnectivity = apiConnectivity;
        if (financeSetup) responseData.financeSetup = financeSetup;

        return createResponse(201, {
            success: true,
            message: "Supplier created successfully",
            data: responseData
        });

    } catch (error) {
        console.error("Error creating supplier:", error);

        await logError(error, {
            function: 'createSupplier',
            supplierId,
            event: JSON.stringify(event)
        });

        if (error.name === 'ConditionalCheckFailedException') {
            return createResponse(409, {
                success: false,
                message: "Supplier ID already exists"
            });
        }

        return createResponse(500, {
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};
