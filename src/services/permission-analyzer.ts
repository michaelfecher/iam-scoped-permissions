import { LogAnalysisResult, SuggestedPermission } from '../types/index.js';

export class PermissionAnalyzerService {
  analyzeLogs(logAnalysisResults: LogAnalysisResult[]): SuggestedPermission[] {
    const permissionMap = new Map<
      string,
      {
        action: string;
        frequency: number;
        resource: string;
        reasoning: string[];
        severity: 'Low' | 'Medium' | 'High' | 'Critical';
        associatedResources: string[];
      }
    >();

    // Process each log analysis result
    for (const result of logAnalysisResults) {
      for (const denial of result.permissionDenials) {
        const action = this.normalizeAction(denial.action);
        const resource = this.normalizeResource(denial.resource);
        const key = `${action}|||${resource}`; // Use a unique separator

        if (permissionMap.has(key)) {
          const existing = permissionMap.get(key)!;
          existing.frequency += 1;
          existing.reasoning.push(
            `Additional denial in ${result.logGroupName}: ${denial.errorCode}`
          );
          if (result.associatedResource) {
            existing.associatedResources.push(result.associatedResource.logicalId);
          }
        } else {
          const severity = this.calculateSeverity(
            action,
            denial.errorCode,
            result.permissionDenials.length
          );
          permissionMap.set(key, {
            action,
            frequency: 1,
            resource,
            reasoning: [`Permission denied in ${result.logGroupName}: ${denial.errorCode}`],
            severity,
            associatedResources: result.associatedResource
              ? [result.associatedResource.logicalId]
              : [],
          });
        }
      }
    }

    // Convert to SuggestedPermission array
    const suggestions: SuggestedPermission[] = [];

    for (const [, data] of permissionMap.entries()) {
      suggestions.push({
        action: data.action || 'Unknown',
        resource: data.resource,
        effect: 'Allow',
        ...(this.generateConditions(data.action || '', data.resource) && {
          condition: this.generateConditions(data.action || '', data.resource)!,
        }),
        reasoning: this.consolidateReasoning(data.reasoning, data.associatedResources),
        frequency: data.frequency,
        severity: data.severity,
      });
    }

    // Sort by severity and frequency
    return suggestions.sort((a, b) => {
      const severityOrder = { Critical: 4, High: 3, Medium: 2, Low: 1 };
      const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.frequency - a.frequency;
    });
  }

  private normalizeAction(action: string): string {
    // Simply return the action in lowercase to maintain consistency
    return action.toLowerCase();
  }

  private normalizeResource(resource: string): string {
    // Handle ARN format
    if (resource.startsWith('arn:aws:')) {
      return resource;
    }

    // Handle partial resource names
    if (resource.includes('/')) {
      return `arn:aws:*:*:*:${resource}`;
    }

    return resource;
  }

  private calculateSeverity(
    action: string,
    errorCode: string,
    totalDenials: number
  ): 'Low' | 'Medium' | 'High' | 'Critical' {
    const lowerAction = action.toLowerCase();

    // Critical: Core functionality blocked
    if (
      errorCode.includes('AccessDenied') &&
      (lowerAction.includes('lambda:invokefunction') ||
        lowerAction.includes('dynamodb:') ||
        lowerAction.includes('s3:getobject'))
    ) {
      return 'Critical';
    }

    // High: Important operations failing frequently
    if (totalDenials > 10 || errorCode.includes('UnauthorizedOperation')) {
      return 'High';
    }

    // Medium: Regular operations failing
    if (totalDenials > 3 || lowerAction.includes('read') || lowerAction.includes('get')) {
      return 'Medium';
    }

    return 'Low';
  }

  private generateConditions(
    action: string,
    resource: string
  ): Record<string, unknown> | undefined {
    const conditions: Record<string, unknown> = {};

    // Add time-based conditions for sensitive actions
    if (action.includes('delete') || action.includes('put') || action.includes('create')) {
      conditions['DateGreaterThan'] = {
        'aws:CurrentTime': new Date().toISOString(),
      };
    }

    // Add source IP conditions for external-facing resources
    if (resource.includes('api') || resource.includes('public')) {
      conditions['IpAddress'] = {
        'aws:SourceIp': ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
      };
    }

    // Add MFA conditions for sensitive operations
    if (action.includes('delete') || action.includes('iam:') || action.includes('admin')) {
      conditions['Bool'] = {
        'aws:MultiFactorAuthPresent': 'true',
      };
    }

    return Object.keys(conditions).length > 0 ? conditions : undefined;
  }

  private consolidateReasoning(reasons: string[], associatedResources: string[]): string {
    const uniqueReasons = [...new Set(reasons)];
    let consolidated = uniqueReasons.join('; ');

    if (associatedResources.length > 0) {
      const uniqueResources = [...new Set(associatedResources)];
      consolidated += `. Associated with CloudFormation resources: ${uniqueResources.join(', ')}`;
    }

    return consolidated;
  }

  generateIAMPolicy(permissions: SuggestedPermission[]): {
    Version: string;
    Statement: Array<{
      Effect: string;
      Action: string[];
      Resource: string[];
      Condition?: Record<string, unknown>;
    }>;
  } {
    // Group permissions by resource and conditions
    const statementMap = new Map<
      string,
      {
        actions: Set<string>;
        resources: Set<string>;
        condition?: Record<string, unknown>;
      }
    >();

    for (const permission of permissions) {
      // Only include permissions that were actually observed (frequency > 0) or are critical
      if (permission.frequency === 0 && permission.severity === 'Low') {
        continue;
      }

      const conditionKey = JSON.stringify(permission.condition || {});
      const key = `${permission.resource}:${conditionKey}`;

      if (statementMap.has(key)) {
        const statement = statementMap.get(key)!;
        statement.actions.add(permission.action);
        statement.resources.add(permission.resource);
      } else {
        statementMap.set(key, {
          actions: new Set([permission.action]),
          resources: new Set([permission.resource]),
          ...(permission.condition && { condition: permission.condition }),
        });
      }
    }

    // Convert to IAM policy format
    const statements = Array.from(statementMap.values()).map(statement => ({
      Effect: 'Allow',
      Action: Array.from(statement.actions).sort(),
      Resource: Array.from(statement.resources).sort(),
      ...(statement.condition && Object.keys(statement.condition).length > 0
        ? { Condition: statement.condition }
        : {}),
    }));

    return {
      Version: '2012-10-17',
      Statement: statements,
    };
  }

  generateCDKCode(permissions: SuggestedPermission[], stackName: string): string {
    const code = [];

    // Header with imports
    code.push('// CDK TypeScript code generated by iam-scoped-permissions');
    code.push('// Copy this code into your CDK application');
    code.push('');
    code.push("import * as iam from 'aws-cdk-lib/aws-iam';");
    code.push("import * as cdk from 'aws-cdk-lib';");
    code.push("import { Construct } from 'constructs';");
    code.push('');

    // Filter permissions (only observed ones or critical)
    const relevantPermissions = permissions.filter(
      p => p.frequency > 0 || p.severity === 'Critical' || p.severity === 'High'
    );

    if (relevantPermissions.length === 0) {
      code.push('// No permissions to generate - no issues found!');
      return code.join('\n');
    }

    // Group permissions by resource type/service to create logical roles
    const serviceGroups = this.groupPermissionsByService(relevantPermissions);

    code.push('// Add this to your CDK Stack class:');
    code.push('');

    let roleIndex = 1;
    for (const [serviceName, servicePermissions] of serviceGroups.entries()) {
      const roleName = this.generateRoleName(serviceName, stackName);

      code.push(`// Role ${roleIndex}: ${serviceName} permissions`);
      code.push(`const ${this.toCamelCase(roleName)} = new iam.Role(this, '${roleName}', {`);
      code.push(
        `  assumedBy: new iam.ServicePrincipal('${this.getServicePrincipal(serviceName)}'),`
      );
      code.push(
        `  description: 'Role for ${serviceName} with least privilege permissions based on log analysis',`
      );
      code.push('});');
      code.push('');

      // Group statements by resource patterns
      const statementGroups = this.groupStatementsByResource(servicePermissions);

      let statementIndex = 1;
      for (const [resourcePattern, actions] of statementGroups.entries()) {
        const policyName = `${roleName}Policy${statementIndex}`;

        code.push(`// Policy ${statementIndex} for ${resourcePattern}`);
        code.push(`${this.toCamelCase(roleName)}.addToPolicy(new iam.PolicyStatement({`);
        code.push(`  sid: '${policyName}',`);
        code.push(`  effect: iam.Effect.ALLOW,`);

        // Add actions
        if (actions.actions.size === 1) {
          code.push(`  actions: ['${Array.from(actions.actions)[0]}'],`);
        } else {
          code.push(`  actions: [`);
          for (const action of Array.from(actions.actions).sort()) {
            code.push(`    '${action}',`);
          }
          code.push(`  ],`);
        }

        // Add resources (minimize wildcards for cdk-nag AWS Solutions IAM5)
        const optimizedResources = Array.from(actions.resources)
          .map(r => this.optimizeResourceArn(r))
          .sort();

        if (optimizedResources.length === 1) {
          code.push(`  resources: ['${optimizedResources[0]}'],`);
        } else {
          code.push(`  resources: [`);
          for (const resource of optimizedResources) {
            code.push(`    '${resource}',`);
          }
          code.push(`  ],`);
        }

        // Add conditions if present
        if (actions.conditions.size > 0) {
          code.push(`  conditions: {`);
          for (const condition of actions.conditions) {
            code.push(`    ${JSON.stringify(condition, null, 4).replace(/^/gm, '    ')},`);
          }
          code.push(`  },`);
        }

        code.push('}));');
        code.push('');

        // Add comment about what triggered this permission
        const triggerReasons = servicePermissions
          .filter(p => actions.actions.has(p.action))
          .map(p => p.reasoning)
          .slice(0, 3);

        if (triggerReasons.length > 0) {
          code.push(`// Triggered by: ${triggerReasons[0]}`);
          if (triggerReasons.length > 1) {
            code.push(`// Additional reasons: ${triggerReasons.slice(1).join(', ')}`);
          }
          code.push('');
        }

        statementIndex++;
      }

      // Note: Managed policies are avoided to comply with cdk-nag AWS Solutions IAM4
      // All permissions are explicitly defined for least privilege access

      roleIndex++;
    }

    // Add instructions
    code.push('');
    code.push('// Instructions:');
    code.push('// 1. Review the generated policies and adjust resource ARNs as needed');
    code.push('// 2. Replace service principals with your actual compute resources');
    code.push('// 3. Test thoroughly in a development environment');
    code.push('// 4. Ensure resource ARNs are as specific as possible (avoid wildcards)');
    code.push('// 5. Remove unused permissions after validation');
    code.push('// 6. This code avoids managed policies to comply with cdk-nag AWS Solutions IAM4');

    return code.join('\n');
  }

  private groupPermissionsByService(
    permissions: SuggestedPermission[]
  ): Map<string, SuggestedPermission[]> {
    const groups = new Map<string, SuggestedPermission[]>();

    for (const permission of permissions) {
      const service = permission.action.split(':')[0] || 'unknown';
      if (!groups.has(service)) {
        groups.set(service, []);
      }
      groups.get(service)!.push(permission);
    }

    return groups;
  }

  private groupStatementsByResource(permissions: SuggestedPermission[]): Map<
    string,
    {
      actions: Set<string>;
      resources: Set<string>;
      conditions: Set<Record<string, unknown>>;
    }
  > {
    const groups = new Map<
      string,
      {
        actions: Set<string>;
        resources: Set<string>;
        conditions: Set<Record<string, unknown>>;
      }
    >();

    for (const permission of permissions) {
      // Create a resource pattern key
      const resourceKey = this.getResourcePattern(permission.resource);

      if (!groups.has(resourceKey)) {
        groups.set(resourceKey, {
          actions: new Set(),
          resources: new Set(),
          conditions: new Set(),
        });
      }

      const group = groups.get(resourceKey)!;
      group.actions.add(permission.action);
      group.resources.add(permission.resource);

      if (permission.condition) {
        group.conditions.add(permission.condition);
      }
    }

    return groups;
  }

  private getResourcePattern(resource: string): string {
    // Group similar resources together
    if (resource.includes('arn:aws:s3:::')) {
      return 'S3 Bucket Access';
    }
    if (resource.includes('arn:aws:dynamodb:')) {
      return 'DynamoDB Table Access';
    }
    if (resource.includes('arn:aws:lambda:')) {
      return 'Lambda Function Access';
    }
    if (resource.includes('arn:aws:logs:')) {
      return 'CloudWatch Logs Access';
    }
    if (resource.includes('arn:aws:iam:')) {
      return 'IAM Access';
    }
    if (resource.includes('arn:aws:ssm:')) {
      return 'Systems Manager Access';
    }
    if (resource.includes('arn:aws:secretsmanager:')) {
      return 'Secrets Manager Access';
    }
    if (resource.includes('arn:aws:kms:')) {
      return 'KMS Access';
    }

    return 'General AWS Access';
  }

  private generateRoleName(service: string, stackName: string): string {
    const cleanStackName = stackName.replace(/[^a-zA-Z0-9]/g, '');
    const cleanService = service.charAt(0).toUpperCase() + service.slice(1);
    return `${cleanStackName}${cleanService}Role`;
  }

  private toCamelCase(str: string): string {
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  private getServicePrincipal(service: string): string {
    const principals: Record<string, string> = {
      lambda: 'lambda.amazonaws.com',
      s3: 's3.amazonaws.com',
      dynamodb: 'dynamodb.amazonaws.com',
      ecs: 'ecs-tasks.amazonaws.com',
      codebuild: 'codebuild.amazonaws.com',
      stepfunctions: 'states.amazonaws.com',
      apigateway: 'apigateway.amazonaws.com',
      logs: 'logs.amazonaws.com',
      ec2: 'ec2.amazonaws.com',
      iam: 'iam.amazonaws.com',
    };

    return principals[service] || `${service}.amazonaws.com`;
  }

  private optimizeResourceArn(resource: string): string {
    // Avoid overly broad wildcards where possible
    // This helps comply with cdk-nag AWS Solutions IAM5

    // For unknown resources, try to make them more specific
    if (resource === 'Unknown' || resource === '*') {
      return '*'; // Keep as is if we can't determine specificity
    }

    // For S3, ensure it's object-level access, not bucket-level
    if (resource.includes('arn:aws:s3:::') && !resource.includes('/*')) {
      return `${resource}/*`;
    }

    // If resource already has wildcards, check if we can make it more specific
    if (resource.includes('*')) {
      // For CloudWatch Logs, be more specific about log group patterns
      if (resource.includes('arn:aws:logs:') && resource.endsWith('*')) {
        // If it's a logs resource ending with *, try to be more specific
        if (resource.includes('log-group:')) {
          return resource; // Already specific enough
        } else {
          // Make it more specific to log groups
          return resource.replace('*', 'log-group:*');
        }
      }
    }

    return resource;
  }
}
