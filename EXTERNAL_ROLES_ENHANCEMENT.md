# External Roles Enhancement for IAM Scoped Permissions

## The GitHub Actions + S3 Deployment Challenge

The current IAM Scoped Permissions tool analyzes **CloudFormation stack resources**, but GitHub Actions deployments typically use **external IAM roles** that aren't part of the stack being deployed to.

### Typical GitHub Actions Setup
```yaml
# .github/workflows/deploy.yml
- name: AWS Credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::123456789012:role/GitHubActions-S3Deploy-Role
    role-session-name: GitHubAction
    aws-region: us-east-1

- name: Deploy to S3
  run: aws s3 sync ./dist s3://my-bucket/
```

**Problem:** The `GitHubActions-S3Deploy-Role` is **not** in the CloudFormation stack that contains the S3 bucket, so the tool won't find permission denials from this role.

## 🚀 Enhancement Solutions

### 1. **Cross-Reference Log Group Analysis**

Enhance the tool to analyze log groups from **multiple sources**:

```typescript
// New CLI option
npm run analyze -- \
  --stack my-app-stack \
  --external-log-groups "/aws/lambda/github-actions-*,CloudTrail/GitHubActions"
```

**Implementation:**
```typescript
// Enhanced stack analyzer
export interface AnalysisConfig {
  stackName: string;
  lookbackDays: number;
  maxLogEvents: number;
  includePatterns: string[];
  excludePatterns: string[];
  
  // NEW: External log group discovery
  externalLogGroups: string[];
  includeCloudTrail: boolean;
  crossAccountRoles: string[];
}
```

### 2. **CloudTrail Integration**

GitHub Actions role usage appears in **CloudTrail logs**, not application log groups:

```typescript
// New service: CloudTrail analyzer
export class CloudTrailService {
  async analyzeAssumeRoleEvents(
    roleNames: string[],
    startTime: Date,
    endTime: Date
  ): Promise<RoleAssumeEvent[]> {
    // Search CloudTrail for AssumeRole events
    // Filter by role names (e.g., "GitHubActions-*")
    // Find subsequent permission denials
  }
}
```

**Example CloudTrail Event:**
```json
{
  "eventName": "AssumeRole",
  "sourceIPAddress": "140.82.112.x", // GitHub Actions IP
  "userAgent": "aws-actions/configure-aws-credentials/4.0.2",
  "requestParameters": {
    "roleArn": "arn:aws:iam::123456789012:role/GitHubActions-S3Deploy-Role",
    "roleSessionName": "GitHubAction"
  }
}
```

### 3. **Multi-Stack Analysis**

Analyze **related stacks** that might contain the external roles:

```bash
# Analyze both app stack and infrastructure stack
npm run analyze -- \
  --stacks "my-app-stack,my-infrastructure-stack" \
  --hours 24
```

### 4. **IAM Role Discovery**

Auto-discover IAM roles that access stack resources:

```typescript
// Enhanced CloudFormation service
export class CloudFormationService {
  async discoverExternalRoles(stackName: string): Promise<ExternalRole[]> {
    const resources = await this.getStackResources(stackName);
    const externalRoles: ExternalRole[] = [];
    
    // Find roles that reference stack resources
    for (const resource of resources) {
      if (resource.resourceType === 'AWS::S3::Bucket') {
        // Search for IAM roles with policies that reference this bucket
        const roles = await this.findRolesWithResourceAccess(resource.physicalId);
        externalRoles.push(...roles);
      }
    }
    
    return externalRoles;
  }
}
```

## 🛠️ Implementation Plan

### Phase 1: Basic External Log Group Support
```typescript
// Add to existing CLI
export interface AnalysisConfig {
  // ... existing fields
  externalLogGroups: string[];  // Manual log group specification
}

// Usage
npm run analyze -- \
  --stack my-app-stack \
  --external-log-groups "/aws/lambda/deployment-*,CloudTrail/deployment"
```

### Phase 2: CloudTrail Integration
```typescript
// New service for CloudTrail analysis
export class CloudTrailAnalyzer {
  async findRoleUsage(
    rolePatterns: string[],
    resourceArns: string[],
    timeRange: TimeRange
  ): Promise<RoleUsageEvent[]> {
    // Search CloudTrail for:
    // 1. AssumeRole events matching patterns
    // 2. Subsequent API calls to resources
    // 3. Permission denial events
  }
}
```

### Phase 3: Smart Role Discovery
```typescript
// Auto-discover external roles
npm run analyze -- \
  --stack my-app-stack \
  --discover-external-roles \
  --include-cloudtrail
```

## 📋 Specific GitHub Actions Enhancement

### CLI Usage
```bash
# Analyze GitHub Actions deployment issues
npm run analyze -- \
  --stack my-s3-app-stack \
  --github-actions \
  --role-patterns "GitHubActions-*,GitHub-*" \
  --hours 2
```

### Expected Output
```
🔍 Analyzing CloudFormation stack: my-s3-app-stack
✅ Found 3 existing log groups from stack resources
🔍 Discovering external roles that access stack resources...
✅ Found 2 external roles: GitHubActions-S3Deploy-Role, GitHubActions-CloudFront-Role

📊 EXTERNAL ROLE ANALYSIS
┌─────────────────────────────┬──────────────┬────────────────────┐
│ Role Name                   │ Last Used    │ Permission Denials │
├─────────────────────────────┼──────────────┼────────────────────┤
│ GitHubActions-S3Deploy-Role │ 2 hours ago  │ 3 denials          │
│ GitHubActions-CloudFront-Role│ 1 day ago    │ 0 denials          │
└─────────────────────────────┴──────────────┴────────────────────┘

🔒 PERMISSION DENIALS FOUND

GitHubActions-S3Deploy-Role:
- s3:PutObjectAcl on s3://my-bucket/assets/* (3 occurrences)
- cloudfront:CreateInvalidation on arn:aws:cloudfront::123456789012:distribution/E1234567890 (1 occurrence)

💡 RECOMMENDED PERMISSIONS

Add to GitHubActions-S3Deploy-Role:
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObjectAcl",
      "Resource": "arn:aws:s3:::my-bucket/assets/*"
    },
    {
      "Effect": "Allow", 
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::123456789012:distribution/E1234567890"
    }
  ]
}
```

## 🔧 Quick Implementation

For immediate use, you can manually specify external log groups:

### 1. **Find GitHub Actions Log Groups**
```bash
# List all log groups that might contain GitHub Actions activity
aws logs describe-log-groups --query 'logGroups[?contains(logGroupName, `CloudTrail`) || contains(logGroupName, `github`) || contains(logGroupName, `actions`)].logGroupName'
```

### 2. **Include in Analysis**
```bash
# Add discovered log groups to analysis
npm run analyze -- \
  --stack my-app-stack \
  --external-log-groups "CloudTrail/aws-api-logs,/aws/lambda/github-deployment" \
  --hours 6
```

### 3. **Search CloudTrail Manually**
```bash
# Use AWS CLI to search CloudTrail for GitHub Actions role usage
aws logs filter-log-events \
  --log-group-name "CloudTrail/aws-api-logs" \
  --start-time $(date -d '2 hours ago' +%s)000 \
  --filter-pattern '{ $.userAgent = "aws-actions/configure-aws-credentials*" }'
```

## 🎯 Result

This enhancement would allow the IAM Scoped Permissions tool to:

1. **Discover external roles** that access stack resources
2. **Analyze CloudTrail logs** for GitHub Actions activity  
3. **Find permission denials** from deployment workflows
4. **Generate targeted IAM policies** for CI/CD roles
5. **Provide complete visibility** into both application and deployment permission issues

The tool would become a comprehensive IAM analysis solution for modern cloud deployments where external automation tools (GitHub Actions, Jenkins, etc.) interact with CloudFormation-managed resources. 