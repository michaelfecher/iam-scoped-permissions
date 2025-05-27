# GitHub Actions IAM Analysis Guide

## Overview

This guide shows how to use the enhanced IAM Scoped Permissions tool to analyze IAM permission issues for **GitHub Actions** deployments to S3 and other AWS resources.

## The Challenge

Your GitHub Actions workflow deploys to S3, but the IAM role it uses is **not part of the CloudFormation stack** containing the S3 bucket. The tool's standard stack analysis won't find permission denials from external roles.

## Solution: External Log Group Analysis

The enhanced tool now supports analyzing **external log groups** that contain permission denials from GitHub Actions roles.

### 1. **Basic Usage with External Log Groups**

```bash
# Analyze your app stack + CloudTrail logs where GitHub Actions activity appears
npm run analyze -- \
  --stack my-s3-app-stack \
  --region us-east-1 \
  --external-log-groups "CloudTrail/aws-api-logs" \
  --hours 6
```

### 2. **GitHub Actions Specific Analysis**

```bash
# Search for GitHub Actions role patterns
npm run analyze -- \
  --stack my-s3-app-stack \
  --region us-east-1 \
  --external-log-groups "CloudTrail/aws-api-logs,/aws/lambda/github-deployment" \
  --role-patterns "GitHubActions-*,GitHub-Deploy-*" \
  --hours 2
```

### 3. **Comprehensive Multi-Source Analysis**

```bash
# Analyze both stack resources AND external activity
npm run analyze -- \
  --stack my-s3-app-stack \
  --region us-east-1 \
  --external-log-groups "CloudTrail/aws-api-logs,CloudTrail/s3-access-logs" \
  --include-cloudtrail \
  --role-patterns "GitHubActions-*" \
  --include "/aws/lambda/.*" \
  --exclude ".*LogRetention.*" \
  --hours 4
```

## Expected Output

```
🔍 IAM Scoped Permissions Analyzer
======================================

Lookback period: 2 hours
Analyzing stack: my-s3-app-stack
Region: us-east-1
External log groups: CloudTrail/aws-api-logs
Role patterns: GitHubActions-*

🔍 Checking existence of 12 predicted log groups...
✅ Found 4 existing log groups
⚠️  8 predicted log groups do not exist:
   - /aws/s3/my-bucket-name
   - /aws/sns/arn:aws:sns:us-east-1:123456789012:notifications
   ... and 6 more

🔒 Found 3 permission denials in CloudTrail/aws-api-logs

## Permission Denials Analysis

### CloudTrail/aws-api-logs
**Total Events:** 3

#### Permission Denial #1
- **Timestamp:** 2025-05-27T16:30:45.123Z
- **Action:** s3:PutObjectAcl
- **Resource:** arn:aws:s3:::my-bucket/assets/index.html
- **Principal:** arn:aws:iam::123456789012:role/GitHubActions-S3Deploy-Role
- **Error Code:** AccessDenied
- **Message:** User: arn:aws:iam::123456789012:role/GitHubActions-S3Deploy-Role is not authorized to perform: s3:PutObjectAcl

#### Permission Denial #2
- **Timestamp:** 2025-05-27T16:30:47.456Z
- **Action:** cloudfront:CreateInvalidation
- **Resource:** arn:aws:cloudfront::123456789012:distribution/E1234567890
- **Principal:** arn:aws:iam::123456789012:role/GitHubActions-S3Deploy-Role
- **Error Code:** AccessDenied

## Suggested IAM Permissions

### Role: GitHubActions-S3Deploy-Role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3ObjectAclAccess",
      "Effect": "Allow",
      "Action": "s3:PutObjectAcl",
      "Resource": "arn:aws:s3:::my-bucket/*"
    },
    {
      "Sid": "CloudFrontInvalidation",
      "Effect": "Allow", 
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::123456789012:distribution/E1234567890"
    }
  ]
}
```

✅ Analysis completed successfully!
⚠️  Found 3 permission denials
🚨 2 critical issues require immediate attention
```

## Finding Your Log Groups

### 1. **Discover CloudTrail Log Groups**
```bash
# List CloudTrail log groups
aws logs describe-log-groups \
  --region us-east-1 \
  --log-group-name-prefix "CloudTrail" \
  --query 'logGroups[].logGroupName'
```

### 2. **Find GitHub Actions Related Log Groups**
```bash
# Search for log groups that might contain GitHub Actions activity
aws logs describe-log-groups \
  --region us-east-1 \
  --query 'logGroups[?contains(logGroupName, `github`) || contains(logGroupName, `actions`) || contains(logGroupName, `deploy`)].logGroupName'
```

### 3. **Manual CloudTrail Search**
```bash
# Search CloudTrail directly for GitHub Actions activity
aws logs filter-log-events \
  --log-group-name "CloudTrail/aws-api-logs" \
  --start-time $(date -d '2 hours ago' +%s)000 \
  --filter-pattern '{ $.userAgent = "aws-actions/configure-aws-credentials*" }' \
  --query 'events[].message' \
  --output text
```

## GitHub Actions Workflow Example

Your typical workflow that triggers permission denials:

```yaml
# .github/workflows/deploy.yml
name: Deploy to S3
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/GitHubActions-S3Deploy-Role
          role-session-name: GitHubAction
          aws-region: us-east-1
      
      - name: Build application
        run: npm run build
      
      - name: Deploy to S3 (may cause permission denials)
        run: |
          aws s3 sync ./dist s3://my-bucket/ --delete
          aws cloudfront create-invalidation --distribution-id E1234567890 --paths "/*"
```

## Advanced Analysis Techniques

### 1. **Multi-Stack Analysis**
If your GitHub Actions role is defined in a separate infrastructure stack:

```bash
# Analyze both application and infrastructure stacks
npm run analyze -- \
  --stack my-app-stack \
  --region us-east-1 \
  --external-log-groups "CloudTrail/aws-api-logs" \
  --hours 2

# Then analyze the infrastructure stack separately
npm run analyze -- \
  --stack my-infrastructure-stack \
  --region us-east-1 \
  --include "/aws/lambda/.*" \
  --hours 2
```

### 2. **Time-Based Analysis**
GitHub Actions runs are episodic, so use precise time ranges:

```bash
# Analyze just the last deployment (30 minutes)
npm run analyze -- \
  --stack my-app-stack \
  --region us-east-1 \
  --external-log-groups "CloudTrail/aws-api-logs" \
  --hours 0.5
```

### 3. **Output for Policy Updates**
Generate the exact IAM policy to fix the issues:

```bash
# Generate only the IAM policy JSON
npm run analyze -- \
  --stack my-app-stack \
  --region us-east-1 \
  --external-log-groups "CloudTrail/aws-api-logs" \
  --policy-only \
  --output github-actions-policy.json \
  --hours 1
```

## Integration with GitHub Actions

You can even run this analysis **within your GitHub Actions workflow** to automatically detect permission issues:

```yaml
# .github/workflows/analyze-permissions.yml
name: Analyze IAM Permissions
on:
  workflow_run:
    workflows: ["Deploy to S3"]
    types: [completed]

jobs:
  analyze:
    if: github.event.workflow_run.conclusion == 'failure'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Install IAM Analyzer
        run: npm install -g iam-scoped-permissions
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.ANALYSIS_ROLE_ARN }}
          aws-region: us-east-1
      
      - name: Analyze Permission Issues
        run: |
          iam-scoped-permissions analyze \
            --stack my-app-stack \
            --region us-east-1 \
            --external-log-groups "CloudTrail/aws-api-logs" \
            --role-patterns "GitHubActions-*" \
            --hours 1 \
            --output permission-analysis.md
      
      - name: Comment on PR
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const analysis = fs.readFileSync('permission-analysis.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## IAM Permission Analysis\n\n${analysis}`
            });
```

## Summary

The enhanced IAM Scoped Permissions tool now provides comprehensive analysis for modern CI/CD deployments where external roles (like GitHub Actions) interact with your CloudFormation-managed resources. This eliminates the blind spot of only analyzing resources within a single stack and gives you complete visibility into IAM permission issues across your entire deployment pipeline. 