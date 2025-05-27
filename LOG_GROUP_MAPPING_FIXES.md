# Log Group Mapping Fixes

## Issues Identified

When running the IAM Scoped Permissions tool on CloudFormation stacks, you may encounter "log group does not exist" errors. This document explains the root causes and fixes applied.

## Root Cause Analysis

### 1. **Over-Mapping Resources**
The original tool mapped **every AWS resource** to predicted log groups, even for resources that don't create CloudWatch log groups:

❌ **Incorrectly Mapped (No Log Groups Created):**
- `AWS::S3::Bucket` → `/aws/s3/{bucket-name}`
- `AWS::SNS::Topic` → `/aws/sns/{topic-arn}`  
- `AWS::SQS::Queue` → `/aws/sqs/{queue-url}`
- `AWS::DynamoDB::Table` → `/aws/dynamodb/{table-name}`
- `AWS::KMS::Key` → `/aws/kms/{key-id}`
- `AWS::IAM::Role` → `/aws/iam/{role-name}`
- `AWS::IAM::Policy` → `/aws/iam/{policy-name}`

### 2. **Incorrect Step Function Mapping**
❌ **Wrong Pattern:**
```typescript
// Incorrect - using full ARN in log group name
'/aws/stepfunctions/arn:aws:states:region:account:stateMachine:name'
```

✅ **Correct Patterns:**
```typescript
// Step Functions can use multiple patterns
'/aws/vendedlogs/states/{state-machine-name}'
'/aws/stepfunctions/{state-machine-name}'
// OR custom log groups defined in CloudFormation
```

### 3. **Missing Conditional Logic**
Many AWS services only create log groups **when logging is explicitly enabled**:
- API Gateway execution logs (optional)
- RDS instance logs (optional, per log type)
- ECS container logs (depends on task definition)

## Fixes Applied

### 1. **Removed Non-Logging Resources**
```typescript
// Removed mappings for resources that don't create log groups
case 'AWS::S3::Bucket':
case 'AWS::SNS::Topic':
case 'AWS::SQS::Queue':
case 'AWS::DynamoDB::Table':
case 'AWS::KMS::Key':
case 'AWS::IAM::Role':
case 'AWS::IAM::Policy':
  // No log groups created - removed mapping
  break;
```

### 2. **Fixed Step Function Pattern**
```typescript
case 'AWS::StepFunctions::StateMachine':
  const stateMachineNameMatch = physicalId.match(/stateMachine:(.+)$/);
  if (stateMachineNameMatch) {
    const stateMachineName = stateMachineNameMatch[1];
    logGroups.push(`/aws/vendedlogs/states/${stateMachineName}`);
    logGroups.push(`/aws/stepfunctions/${stateMachineName}`);
  }
  break;
```

### 3. **Added Existence Checking**
```typescript
// New: Check which log groups actually exist before analysis
console.log(`🔍 Checking existence of ${logGroupNames.length} predicted log groups...`);

for (const logGroupName of logGroupNames) {
  const logGroupExists = await this.checkLogGroupExists(logGroupName);
  if (logGroupExists) {
    validLogGroups.push(logGroupName);
  } else {
    nonExistentLogGroups.push(logGroupName);
  }
}

console.log(`✅ Found ${validLogGroups.length} existing log groups`);
console.log(`⚠️  ${nonExistentLogGroups.length} predicted log groups do not exist`);
```

### 4. **Enhanced Error Reporting**
The tool now provides clear feedback about which predicted log groups don't exist:
```
⚠️  12 predicted log groups do not exist:
   - /aws/s3/my-bucket-name
   - /aws/sns/arn:aws:sns:region:account:topic-name
   - /aws/sqs/https://sqs.region.amazonaws.com/account/queue-name
   ... and 9 more
```

## Recommendations for Stack Analysis

### 1. **Focus on Actual Log Producers**
Only these resources typically create CloudWatch log groups:
- ✅ `AWS::Lambda::Function`
- ✅ `AWS::Logs::LogGroup` (explicit)
- ✅ `AWS::ApiGateway::RestApi` (if logging enabled)
- ✅ `AWS::StepFunctions::StateMachine` (if logging configured)
- ✅ `AWS::ECS::Service` (if task definition specifies logging)
- ✅ `AWS::CodeBuild::Project`
- ✅ `AWS::RDS::DBInstance` (if log exports enabled)

### 2. **Use Include/Exclude Patterns**
Filter analysis to focus on relevant log groups:
```bash
# Focus only on Lambda and Step Function logs
npm run analyze -- --stack my-stack --include-patterns "/aws/lambda/.*,/aws/stepfunctions/.*"

# Exclude CDK-generated resources
npm run analyze -- --stack my-stack --exclude-patterns ".*LogRetention.*,.*CustomResource.*"
```

### 3. **Start with Recent Timeframes**
Use shorter time windows for initial testing:
```bash
# Analyze last 2 hours instead of 7 days
npm run analyze -- --stack my-stack --hours 2
```

## Verification Commands

Test the improved log group discovery:
```bash
# Build with fixes
npm run build

# Test on your stack
npm run analyze -- --stack your-stack-name --hours 1

# Should now show:
# ✅ Found X existing log groups
# ⚠️  Y predicted log groups do not exist
# 🔒 Found Z permission denials in [actual-log-group]
```

## Known Limitations

1. **Step Function Log Groups**: These are often custom log groups defined in CloudFormation rather than following predictable patterns
2. **ECS Logging**: Log group names depend on task definition configuration
3. **Custom Resources**: Lambda-backed custom resources may have unpredictable log group names

The tool now handles these gracefully by checking existence before analysis and providing clear feedback about which predictions were incorrect. 