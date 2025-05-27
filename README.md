# IAM Scoped Permissions Analyzer

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-blue)](https://www.typescriptlang.org/)
[![AWS SDK v3](https://img.shields.io/badge/AWS_SDK-v3-orange)](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)

A powerful TypeScript tool that analyzes AWS CloudFormation stacks and their associated CloudWatch log groups to identify missing IAM permissions and generate least-privilege IAM policies.

## 🎯 Purpose

This tool helps you achieve **least privilege access** by:

1. **Analyzing CloudFormation stacks** to discover all resources and their associated log groups
2. **Scanning CloudWatch logs** for permission denial errors (AccessDenied, UnauthorizedOperation, etc.)
3. **Correlating log errors** with specific CloudFormation resources
4. **Generating minimal IAM policies** with only the permissions that are actually needed
5. **Providing actionable recommendations** with severity levels and reasoning

## ✨ Features

- 🔍 **Comprehensive Log Analysis**: Scans multiple log group patterns for various AWS services
- 🎯 **Smart Permission Detection**: Identifies specific actions and resources from error messages
- 📊 **Severity Classification**: Categorizes issues as Critical, High, Medium, or Low priority
- 🛡️ **Security-First Approach**: Suggests conditions for sensitive operations (MFA, IP restrictions, etc.)
- 📝 **Multiple Output Formats**: Generate reports in Markdown, JSON, IAM policy, or CDK TypeScript format
- 🏗️ **CDK Integration**: Generate ready-to-use CDK TypeScript code for roles and policies
- 🔧 **Flexible Filtering**: Include/exclude log groups with regex patterns
- 🚀 **Modern TypeScript**: Built with latest AWS SDK v3, ESLint, and Prettier

## 🚀 Installation

```bash
# Clone or navigate to the project directory
cd iam-scoped-permissions

# Install dependencies
npm install

# Build the project
npm run build

# Run the tool
npm start -- analyze --help
```

## 📋 Prerequisites

- Node.js 18.0.0 or higher
- AWS credentials configured (via AWS CLI, environment variables, or IAM roles)
- Permissions to read CloudFormation stacks and CloudWatch logs

### Required AWS Permissions

Your AWS credentials need the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackResources",
        "logs:DescribeLogGroups",
        "logs:FilterLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

## 🔧 Usage

### Basic Analysis

```bash
# Analyze a CloudFormation stack
npm start -- analyze -s my-stack-name -r us-east-1

# Or using the built version
node dist/index.js analyze -s my-stack-name -r us-east-1
```

### Advanced Options

```bash
# Analyze with custom lookback period and save report
npm start -- analyze -s my-stack -r us-east-1 -d 14 -o report.md

# Generate only the IAM policy JSON
npm start -- analyze -s my-stack -r us-east-1 --policy-only -o policy.json

# Generate CDK TypeScript code for roles and policies
npm start -- analyze -s my-stack -r us-east-1 --cdk -o cdk-roles.ts

# Include only Lambda function logs
npm start -- analyze -s my-stack -r us-east-1 -i "/aws/lambda/.*"

# Exclude CloudTrail logs
npm start -- analyze -s my-stack -r us-east-1 -e ".*cloudtrail.*"

# Analyze more log events per group
npm start -- analyze -s my-stack -r us-east-1 -m 5000
```

### Command Options

| Option | Description | Default |
|--------|-------------|---------|
| `-s, --stack <name>` | CloudFormation stack name (required) | - |
| `-r, --region <region>` | AWS region (required) | - |
| `-d, --days <number>` | Days to look back in logs | 7 |
| `-m, --max-events <number>` | Max log events per log group | 1000 |
| `-i, --include <patterns...>` | Include log groups matching regex | [] |
| `-e, --exclude <patterns...>` | Exclude log groups matching regex | [] |
| `-o, --output <file>` | Output file path | console |
| `--policy-only` | Output only IAM policy JSON | false |
| `--cdk` | Output CDK TypeScript code for roles and policies | false |
| `--json` | Output full results as JSON | false |

## 📊 Output Examples

### Markdown Report

```markdown
# IAM Scoped Permissions Analysis Report

**Stack Name:** my-application-stack
**Region:** us-east-1
**Analysis Date:** 2024-01-15T10:30:00.000Z

## Summary

- **Total Resources:** 12
- **Log Groups Analyzed:** 8
- **Permission Denials Found:** 23
- **Suggested Permissions:** 15
- **Critical Issues:** 3
- **High Priority Issues:** 5

## Critical & High Priority Permissions

### s3:GetObject (Critical)

**Resource:** `arn:aws:s3:::my-bucket/*`
**Frequency:** 15 occurrences
**Reasoning:** Permission denied in /aws/lambda/my-function: AccessDenied

### dynamodb:PutItem (High)

**Resource:** `arn:aws:dynamodb:us-east-1:123456789012:table/my-table`
**Frequency:** 8 occurrences
**Reasoning:** Permission denied in /aws/lambda/my-function: AccessDenied
```

### IAM Policy Output

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::my-bucket/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:123456789012:table/my-table"
      ]
    }
  ]
}
```

### CDK TypeScript Output

```typescript
// CDK TypeScript code generated by iam-scoped-permissions
// Copy this code into your CDK application

import * as iam from 'aws-cdk-lib/aws-iam';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Add this to your CDK Stack class:

// Role 1: s3 permissions
const myApplicationStackS3Role = new iam.Role(this, 'MyApplicationStackS3Role', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  description: 'Role for s3 with least privilege permissions based on log analysis',
});

// Policy 1 for S3 Bucket Access
myApplicationStackS3Role.addToPolicy(new iam.PolicyStatement({
  sid: 'S3BucketAccess',
  effect: iam.Effect.ALLOW,
  actions: ['s3:GetObject', 's3:PutObject'],
  resources: ['arn:aws:s3:::my-bucket/*'],
}));

// Role 2: dynamodb permissions  
const myApplicationStackDynamodbRole = new iam.Role(this, 'MyApplicationStackDynamodbRole', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  description: 'Role for dynamodb with least privilege permissions based on log analysis',
});

// Policy 1 for DynamoDB Table Access
myApplicationStackDynamodbRole.addToPolicy(new iam.PolicyStatement({
  sid: 'DynamoDBTableAccess',
  effect: iam.Effect.ALLOW,
  actions: ['dynamodb:GetItem', 'dynamodb:PutItem'],
  resources: ['arn:aws:dynamodb:us-east-1:123456789012:table/my-table'],
}));

// Instructions:
// 1. Review the generated policies and adjust resource ARNs as needed
// 2. Replace service principals with your actual compute resources  
// 3. Test thoroughly in a development environment
// 4. Consider using managed policies where appropriate
// 5. Remove unused permissions after validation
```

## 🏗️ Architecture

The tool consists of several key components:

### Core Services

1. **CloudFormationService**: Discovers stack resources and maps them to log groups
2. **CloudWatchLogsService**: Searches log groups for permission denial patterns
3. **PermissionAnalyzerService**: Analyzes denials and generates policy recommendations
4. **StackAnalyzerService**: Orchestrates the analysis workflow

### Supported AWS Services

The tool automatically detects log groups for:

- **AWS Lambda** (`/aws/lambda/*`)
- **API Gateway** (`/aws/apigateway/*`)
- **Step Functions** (`/aws/stepfunctions/*`)
- **ECS** (`/ecs/*`)
- **RDS** (`/aws/rds/*`)
- **Custom Log Groups** (explicitly defined)

### Permission Detection Patterns

The tool searches for these error patterns:

- `AccessDenied`
- `UnauthorizedOperation`
- `Forbidden`
- `InvalidUserID.NotFound`
- `InvalidAction`
- `NoSuchBucket`
- `CredentialsNotFound`
- `InvalidAccessKeyId`
- And many more...

## 🛠️ Development

### Scripts

```bash
# Development with hot reload
npm run dev

# Build TypeScript
npm run build

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Type check without building
npm run type-check
```

### Project Structure

```
src/
├── types/           # TypeScript type definitions
├── services/        # Core business logic
│   ├── cloudformation.ts
│   ├── cloudwatch-logs.ts
│   ├── permission-analyzer.ts
│   └── stack-analyzer.ts
└── index.ts         # CLI application entry point
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🔍 Why This Approach Works

This tool is excellent for achieving least privilege because it:

1. **Uses Real Data**: Analyzes actual permission failures from your running applications
2. **Provides Context**: Links errors to specific CloudFormation resources
3. **Suggests Conditions**: Recommends security conditions for sensitive operations
4. **Prioritizes Issues**: Helps you focus on critical problems first
5. **Generates Policies**: Creates ready-to-use IAM policies with minimal permissions

By analyzing your CloudWatch logs, you get a data-driven approach to IAM policy creation that reflects your application's actual needs rather than overly broad permissions.

## 🚀 Quick Start Example

Here's a real example analyzing a CDK stack:

```bash
# 1. Install and build
npm install && npm run build

# 2. Analyze a stack (last 24 hours)
npm start -- analyze -s my-cdk-stack -r us-east-1 --hours 24

# 3. Generate IAM policy only
npm start -- analyze -s my-cdk-stack -r us-east-1 --policy-only -o policy.json

# 4. Generate CDK code with roles
npm start -- analyze -s my-cdk-stack -r us-east-1 --cdk -o roles.ts
```

## 🎯 Use Cases

- **DevOps/Platform Teams**: Automatically generate least-privilege policies for new applications
- **Security Audits**: Identify over-permissioned roles and tighten security
- **CI/CD Integration**: Validate permissions during deployment pipelines  
- **Developer Productivity**: Quick policy generation without manual IAM research
- **Compliance**: Demonstrate least-privilege access for security frameworks

## 🔧 Integration Examples

### CI/CD Pipeline Integration

```yaml
# GitHub Actions example
- name: Analyze IAM Permissions
  run: |
    npm install -g @your-org/iam-scoped-permissions
    iam-scoped-permissions analyze -s ${{ env.STACK_NAME }} -r ${{ env.AWS_REGION }} --hours 2 --json > permissions-report.json
    
- name: Comment on PR with Permissions
  uses: actions/github-script@v6
  with:
    script: |
      const fs = require('fs');
      const report = JSON.parse(fs.readFileSync('permissions-report.json', 'utf8'));
      // Process and comment on PR with findings
```

### AWS Lambda Integration

```typescript
// Use in a Lambda function for automated analysis
import { StackAnalyzerService } from 'iam-scoped-permissions';

export const handler = async (event: any) => {
  const analyzer = new StackAnalyzerService(process.env.AWS_REGION!);
  const result = await analyzer.analyzeStack({
    stackName: event.stackName,
    region: process.env.AWS_REGION!,
    lookbackDays: 1,
    // ... other config
  });
  
  // Send to Slack, email, or store in database
  return result;
};
```

## ⚠️ Limitations

- Requires CloudFormation-deployed resources
- Limited to services that write structured logs to CloudWatch
- Historical analysis depends on log retention policies
- Some permission denials may not appear in CloudWatch logs

## 🆘 Troubleshooting

### Common Issues

**Q: No permission denials found**
A: Check that your applications are actually running and encountering errors. Try a longer lookback period with `-d 30`.

**Q: Too many log groups to analyze**
A: Use include/exclude patterns to focus on specific services: `-i "/aws/lambda/.*" -e ".*test.*"`

**Q: Tool runs slowly**
A: Reduce the number of log events analyzed with `-m 500` or use a shorter time period.

**Q: Generated policies are too broad**
A: The tool suggests minimal permissions based on errors found. Review and adjust ARNs for your specific use case.

## 🌟 Star History

Give this project a ⭐ if it helped you achieve better IAM security!

## 📞 Support

- 🐛 **Issues**: Report bugs via GitHub Issues
- 💡 **Feature Requests**: Submit ideas via GitHub Issues  
- 📖 **Documentation**: Check the README and code comments
- 🤝 **Contributions**: Pull requests welcome! 