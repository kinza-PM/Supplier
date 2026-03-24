import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { v4 as uuidv4 } from 'uuid';
import Busboy from 'busboy';

const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-west-1" });
const sqsClient = new SQSClient({ region: process.env.AWS_REGION || "eu-west-1" });

async function uploadDocument(file, supplierId) {
    try {
        const fileExtension = file.filename.split('.').pop().toLowerCase();
        const allowedExtensions = ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx', 'xlsx', 'xls', 'txt'];
        
        if (!allowedExtensions.includes(fileExtension)) {
            throw new Error(`Invalid file type. Only ${allowedExtensions.join(', ')} are allowed.`);
        }

        const key = `documents/${supplierId}/${uuidv4()}.${fileExtension}`;
        
        const command = new PutObjectCommand({
            Bucket: process.env.DOCUMENTS_BUCKET,
            Key: key,
            Body: file.content,
            ContentType: file.contentType || `application/octet-stream`,
            Metadata: {
                originalName: file.filename,
                supplierId: supplierId
            }
        });
        
        await s3Client.send(command);
        return {
            key: key,
            url: `https://${process.env.DOCUMENTS_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
            filename: file.filename
        };
    } catch (error) {
        console.error("Failed to upload document:", error);
        throw error;
    }
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function isValidPhoneNumber(countryCode, number) {
    if (!countryCode || !number) return false;
    
    const codeRegex = /^\+?\d{1,4}$/;
    const numberRegex = /^\d{6,15}$/;
    
    return codeRegex.test(countryCode) && numberRegex.test(number);
}

let _reqCtx = {};
function setRequestContext(event, context) {
    _reqCtx = {
        path: event?.path || event?.resource || "",
        method: event?.httpMethod || "",
        userId: event?.headers?.user_id || event?.requestContext?.authorizer?.sub || "unknown",
        requestId: context?.awsRequestId || "",
    };
}

function createResponse(statusCode, body, headers = {}) {
    if (statusCode >= 500) {
        const queueUrl = process.env.ERROR_LOG_QUEUE_URL;
        if (queueUrl) {
            sqsClient.send(new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify({
                    service: "supplier",
                    statusCode,
                    errorTitle: statusCode >= 500 ? "Internal Server Error" : "Client Error",
                    errorMessage: body?.message || "",
                    path: _reqCtx.path || "",
                    method: _reqCtx.method || "",
                    userId: _reqCtx.userId || "unknown",
                    requestId: _reqCtx.requestId || "",
                    metadata: {
                        responseBody: body,
                    },
                }),
            })).catch(() => { /* silent */ });
        }
    }

    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': true,
            ...headers
        },
        body: JSON.stringify(body)
    };
}

function parseMultipartFormData(event) {
    return new Promise((resolve, reject) => {
        const contentType = event.headers['content-type'] || event.headers['Content-Type'];
        
        if (contentType?.includes('application/json')) {
            try {
                const body = event.isBase64Encoded 
                    ? Buffer.from(event.body, 'base64').toString('utf-8')
                    : event.body;
                resolve({ fields: JSON.parse(body), files: [] });
            } catch (error) {
                reject(new Error("Invalid JSON in request body"));
            }
            return;
        }

        const result = { fields: {}, files: [] };
        
        const busboy = Busboy({
            headers: {
                'content-type': contentType
            },
            limits: {
                fileSize: 10 * 1024 * 1024,
                files: 10
            }
        });

        busboy.on('file', (fieldname, file, info) => {
            const { filename, encoding, mimeType } = info;
            const chunks = [];
            
            file.on('data', (chunk) => {
                chunks.push(chunk);
            });
            
            file.on('end', () => {
                result.files.push({
                    fieldname,
                    filename,
                    encoding,
                    contentType: mimeType,
                    content: Buffer.concat(chunks)
                });
            });
        });

        busboy.on('field', (fieldname, value) => {
            if (fieldname.includes('[')) {
                const matches = fieldname.match(/^([^\[]+)\[([^\]]+)\]$/);
                if (matches) {
                    const [, parent, child] = matches;
                    if (!result.fields[parent]) {
                        result.fields[parent] = {};
                    }
                    result.fields[parent][child] = value;
                } else {
                    result.fields[fieldname] = value;
                }
            } else {
                result.fields[fieldname] = value;
            }
        });

        busboy.on('finish', () => {
            resolve(result);
        });

        busboy.on('error', (error) => {
            reject(error);
        });

        const bodyBuffer = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64')
            : Buffer.from(event.body);
        
        busboy.end(bodyBuffer);
    });
}

function generateSupplierId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `SUP-${timestamp}-${random}`.toUpperCase();
}

function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input.trim().replace(/[<>]/g, '');
}

async function logError(error, context) {
    const errorLog = {
        type: 'error',
        error: {
            message: error.message,
            stack: error.stack,
            name: error.name
        },
        context,
        timestamp: new Date().toISOString()
    };

    console.error("Error occurred:", errorLog);
}

export {
    uploadDocument,
    isValidEmail,
    isValidPhoneNumber,
    createResponse,
    setRequestContext,
    parseMultipartFormData,
    generateSupplierId,
    sanitizeInput,
    logError
};
