# Supplier Management Service

A serverless AWS Lambda-based supplier management system with CRUD operations, status management, and API activation controls.

## Features

- **Complete CRUD Operations** for suppliers
- **Status Management**: Active, In-Active, Suspended, Blacklisted
- **API Status Control**: Enable/disable API access per supplier
- **Document Upload**: Support for multiple document types
- **Audit Trail**: Complete history logging for all changes
- **Multi-Index Queries**: Filter by status, category, type, or code

## Supplier Fields

### Basic Information
- **name**: Supplier name
- **code**: Unique supplier code (auto-uppercased)
- **category**: Flight, Hotel, Insurance, Rent-a-Car
- **type**: GDS, Aggregator, Direct Contract
- **contactPerson**: Contact person name
- **email**: Contact email
- **contact**: Country code and phone number
- **address**: Physical address
- **city**: City
- **country**: Country
- **documents**: Uploaded documents (PDF, DOC, DOCX, XLS, XLSX, images)
- **status**: Active, In-Active, Suspended, Blacklisted
- **apiStatus**: Active, In-Active

### Configuration Fields (Optional)
- **flightMapping**: Object containing LCC and FCC airline mappings
  - `lcc`: Array of Low-Cost Carrier codes
  - `fcc`: Array of Full-Service Carrier codes
- **hotelMapping**: Object containing hotel supplier mappings
  - `starRatings`: Array of star ratings (1-5)
  - `suppliers`: Array of hotel supplier names
- **apiConnectivity**: Object containing API connection details
  - `apiKey`: API key for authentication
  - `apiSecret`: API secret for authentication
  - `endpointUrl`: Base URL for API endpoint
  - `defaultCurrency`: Default currency code (e.g., USD, EUR)
- **financeSetup**: Object containing pricing configuration
  - `commission`: Commission percentage
  - `markup`: Markup percentage
  - `taxRate`: Tax rate percentage

## API Endpoints

### Create Supplier
```
POST /supplier
Authorization: Required (authorizerLayer)
Content-Type: application/json or multipart/form-data

Body (JSON):
{
  "name": "Supplier Name",
  "code": "SUP001",
  "category": "Flight",
  "type": "GDS",
  "contactPerson": "John Doe",
  "email": "contact@supplier.com",
  "contact": {
    "countryCode": "+971",
    "number": "501234567"
  },
  "address": "123 Main St",
  "city": "Dubai",
  "country": "UAE",
  "flightMapping": {
    "lcc": ["FZ", "G9"],
    "fcc": ["EK", "QR"]
  },
  "hotelMapping": {
    "starRatings": [3, 4, 5],
    "suppliers": ["Booking.com", "Expedia"]
  },
  "apiConnectivity": {
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret",
    "endpointUrl": "https://api.supplier.com",
    "defaultCurrency": "USD"
  },
  "financeSetup": {
    "commission": 5,
    "markup": 3,
    "taxRate": 0
  }
}
```

### Update Supplier
```
PUT /supplier/{supplierId}
Authorization: Required (authorizerLayer)
Content-Type: application/json or multipart/form-data

Body: Any combination of supplier fields
```

### Get All Suppliers
```
GET /suppliers?status=Active&category=Flight&type=GDS&limit=50&all=true
Authorization: Required (authorizerLayer)

Query Parameters:
- status: Filter by status
- category: Filter by category
- type: Filter by type
- limit: Results per page (default: 50)
- lastEvaluatedKey: Pagination token
- all: Set to 'true' to get all suppliers without filters
```

### Get Supplier by ID
```
GET /supplier/{supplierId}?includeHistory=true
Authorization: Required (authorizerLayer)

Query Parameters:
- includeHistory: Include audit history (true/false)
```

### Delete Supplier
```
DELETE /supplier/{supplierId}
Authorization: Required (authorizerLayer)
```

### Update Supplier Status
```
PATCH /supplier/{supplierId}/status
Authorization: Required (authorizerLayer)
Content-Type: application/json

Body:
{
  "status": "Active" | "In-Active" | "Suspended" | "Blacklisted"
}
```

### Toggle API Status
```
PATCH /supplier/{supplierId}/api-status
Authorization: Required (authorizerLayer)
Content-Type: application/json

Body:
{
  "apiStatus": "Active" | "In-Active"
}
```

## DynamoDB Tables

### suppliers-{stage}
- **Primary Key**: supplierId
- **GSI**: CodeIndex (code)
- **GSI**: StatusIndex (status + createdAt)
- **GSI**: CategoryIndex (category + createdAt)
- **GSI**: TypeIndex (type + createdAt)

### supplier-history-{stage}
- **Primary Key**: historyId
- **GSI**: SupplierIdIndex (supplierId + timestamp)

## S3 Bucket

- **supplier-documents-{stage}**: Stores uploaded documents

## Deployment

```bash
# Install dependencies
npm install

# Deploy to AWS
npm run deploy

# Or with specific stage
serverless deploy --config serverless-dev.yaml --stage dev

# Remove deployment
npm run remove
```

## Environment Variables

Set in AWS Systems Manager Parameter Store:
- `/provesio/cognitouserid` - Cognito Client ID
- `/provesio/cognitouserpoolid` - Cognito User Pool ID

## History Actions

The system logs the following actions:
- `SUPPLIER_CREATED`
- `SUPPLIER_UPDATED`
- `SUPPLIER_DELETED`
- `STATUS_CHANGED`
- `API_STATUS_CHANGED`

## Error Handling

- All 500+ errors are automatically logged to SQS queue: `error-log-queue-{stage}`
- Comprehensive error responses with appropriate HTTP status codes
- Validation for all input fields

## File Upload Support

Supported document types:
- Images: jpg, jpeg, png
- Documents: pdf, doc, docx, xls, xlsx, txt
- Max file size: 10MB per file
- Max files: 10 per request
