import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  FilterLogEventsCommand,
  FilteredLogEvent,
} from '@aws-sdk/client-cloudwatch-logs';
import { PermissionDenial, LogAnalysisResult, CloudFormationResource } from '../types/index.js';

export class CloudWatchLogsService {
  private client: CloudWatchLogsClient;

  constructor(region: string) {
    this.client = new CloudWatchLogsClient({ region });
  }

  /**
   * Discover all log groups that exist in CloudWatch Logs.
   * Optionally filter by patterns that suggest they're related to a specific stack.
   */
  async discoverAllLogGroups(stackName?: string): Promise<{
    all: string[];
    cloudTrail: string[];
    stackRelated: string[];
  }> {
    try {
      const allLogGroups: string[] = [];
      const cloudTrailLogGroups: string[] = [];
      const stackRelatedLogGroups: string[] = [];
      let nextToken: string | undefined;

      console.log('🔍 Discovering all log groups in CloudWatch Logs...');

      do {
        const command = new DescribeLogGroupsCommand({
          nextToken,
          limit: 50,
        });

        const result = await this.client.send(command);

        if (result.logGroups) {
          for (const logGroup of result.logGroups) {
            if (logGroup.logGroupName) {
              allLogGroups.push(logGroup.logGroupName);

              // Categorize CloudTrail log groups
              if (this.isCloudTrailLogGroup(logGroup.logGroupName)) {
                cloudTrailLogGroups.push(logGroup.logGroupName);
              }

              // Categorize stack-related log groups
              if (stackName && this.isStackRelatedLogGroup(logGroup.logGroupName, stackName)) {
                stackRelatedLogGroups.push(logGroup.logGroupName);
              }
            }
          }
        }

        nextToken = result.nextToken;
      } while (nextToken);

      console.log(`✅ Discovered ${allLogGroups.length} total log groups`);
      if (cloudTrailLogGroups.length > 0) {
        console.log(`   - ${cloudTrailLogGroups.length} CloudTrail log groups`);
      }
      if (stackName && stackRelatedLogGroups.length > 0) {
        console.log(`   - ${stackRelatedLogGroups.length} potentially related to stack "${stackName}"`);
      }

      return {
        all: allLogGroups,
        cloudTrail: cloudTrailLogGroups,
        stackRelated: stackRelatedLogGroups
      };
    } catch (error) {
      console.warn('Failed to discover log groups:', error);
      return { all: [], cloudTrail: [], stackRelated: [] };
    }
  }

  async discoverCloudTrailLogGroups(): Promise<string[]> {
    const discovered = await this.discoverAllLogGroups();
    return discovered.cloudTrail;
  }

  private isCloudTrailLogGroup(logGroupName: string): boolean {
    return (
      logGroupName.includes('CloudTrail') ||
      logGroupName.includes('cloudtrail') ||
      logGroupName.includes('aws-cloudtrail') ||
      logGroupName.includes('/aws/cloudtrail/') ||
      logGroupName.match(/CloudTrail\/.*/) !== null ||
      logGroupName.match(/aws-api-logs/) !== null ||
      logGroupName.match(/trail-logs/) !== null
    );
  }

  private isStackRelatedLogGroup(logGroupName: string, stackName: string): boolean {
    // Check if log group name contains the stack name
    if (logGroupName.includes(stackName)) {
      return true;
    }

    // Check for common patterns that might be related to the stack
    const stackPrefix = stackName.toLowerCase();
    const logGroupLower = logGroupName.toLowerCase();

    // Look for log groups that start with stack name or contain it
    return (
      logGroupLower.includes(stackPrefix) ||
      logGroupLower.includes(stackPrefix.replace('-', '')) ||
      logGroupLower.includes(stackPrefix.replace('_', ''))
    );
  }

  async analyzeLogGroups(
    logGroupNames: string[],
    resources: CloudFormationResource[],
    lookbackDays: number = 7,
    maxEvents: number = 1000,
    rolePatterns?: string[]
  ): Promise<LogAnalysisResult[]> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const results: LogAnalysisResult[] = [];
    const nonExistentLogGroups: string[] = [];
    const validLogGroups: string[] = [];

    // First, check which log groups actually exist
    console.log(`🔍 Checking existence of ${logGroupNames.length} log groups...`);
    
    for (const logGroupName of logGroupNames) {
      try {
        const logGroupExists = await this.checkLogGroupExists(logGroupName);
        if (logGroupExists) {
          validLogGroups.push(logGroupName);
        } else {
          nonExistentLogGroups.push(logGroupName);
        }
      } catch (error) {
        console.error(`❌ Error checking log group ${logGroupName}:`, error);
        nonExistentLogGroups.push(logGroupName);
      }
    }

    console.log(`✅ Found ${validLogGroups.length} existing log groups`);
    if (nonExistentLogGroups.length > 0) {
      console.log(`⚠️  ${nonExistentLogGroups.length} log groups do not exist:`);
      for (const missing of nonExistentLogGroups.slice(0, 10)) { // Show first 10
        console.log(`   - ${missing}`);
      }
      if (nonExistentLogGroups.length > 10) {
        console.log(`   ... and ${nonExistentLogGroups.length - 10} more`);
      }
    }

    // Analyze only existing log groups
    for (const logGroupName of validLogGroups) {
      try {
        const permissionDenials = await this.searchPermissionDenials(
          logGroupName,
          startTime,
          endTime,
          maxEvents,
          rolePatterns
        );

        const associatedResource = this.findAssociatedResource(logGroupName, resources);

        results.push({
          logGroupName,
          associatedResource,
          permissionDenials,
          totalEvents: permissionDenials.length,
          timeRange: { start: startTime, end: endTime },
        });

        if (permissionDenials.length > 0) {
          console.log(`🔒 Found ${permissionDenials.length} permission denials in ${logGroupName}`);
        }
      } catch (error) {
        console.error(`❌ Error analyzing log group ${logGroupName}:`, error);
        // Continue with other log groups even if one fails
      }
    }

    return results;
  }

  private async checkLogGroupExists(logGroupName: string): Promise<boolean> {
    try {
      // Validate log group name format - skip invalid names
      if (!this.isValidLogGroupName(logGroupName)) {
        console.warn(`Skipping invalid log group name: ${logGroupName}`);
        return false;
      }

      const command = new DescribeLogGroupsCommand({
        logGroupNamePrefix: logGroupName,
        limit: 1,
      });
      const response = await this.client.send(command);
      return response.logGroups?.some(lg => lg.logGroupName === logGroupName) ?? false;
    } catch (error) {
      console.error(`Error checking if log group ${logGroupName} exists:`, error);
      return false;
    }
  }

  private isValidLogGroupName(logGroupName: string): boolean {
    // CloudWatch log group names must match pattern: [\.\-_/#A-Za-z0-9]+
    // Skip ARNs, URLs, and other invalid formats
    if (logGroupName.includes('arn:aws:') || 
        logGroupName.includes('https://') ||
        logGroupName.includes('amazonaws.com') ||
        !/^[\.\-_\/#A-Za-z0-9]+$/.test(logGroupName)) {
      return false;
    }
    return true;
  }

  private async searchPermissionDenials(
    logGroupName: string,
    startTime: Date,
    endTime: Date,
    maxEvents: number,
    rolePatterns?: string[]
  ): Promise<PermissionDenial[]> {
    const permissionDenials: PermissionDenial[] = [];

    try {
      // First, try with a broad text-based filter pattern for Step Functions and other services
      const broadFilterPattern = `"AccessDenied" OR "UnauthorizedOperation" OR "Forbidden" OR "not authorized" OR "permission denied" OR "access denied" OR "InvalidAction" OR "CredentialsNotFound" OR "InvalidAccessKeyId" OR "AuthorizationFailure" OR "User is not authorized" OR "is not authorized to perform"`;

      const command = new FilterLogEventsCommand({
        logGroupName,
        startTime: startTime.getTime(),
        endTime: endTime.getTime(),
        filterPattern: broadFilterPattern,
        limit: maxEvents,
      });

      const response = await this.client.send(command);

      if (response.events) {
        for (const event of response.events) {
          const denial = this.parsePermissionDenial(event, logGroupName);
          if (denial) {
            permissionDenials.push(denial);
          }
        }
      }

      // If no results with broad filter, try without any filter for State Machine log groups
      // (Step Functions often have different log formats)
      const isStateMachineLogGroup = logGroupName.toLowerCase().includes('stepfunction') || 
                                    logGroupName.toLowerCase().includes('statemachine') ||
                                    logGroupName.includes('/aws/stepfunctions/');
      
      if (permissionDenials.length === 0 && isStateMachineLogGroup) {
        console.log(`No results with filter for ${logGroupName}, trying without filter...`);
        
        const noFilterCommand = new FilterLogEventsCommand({
          logGroupName,
          startTime: startTime.getTime(),
          endTime: endTime.getTime(),
          limit: Math.min(maxEvents, 100), // Limit to avoid too much data
        });

        const noFilterResponse = await this.client.send(noFilterCommand);
        
        if (noFilterResponse.events) {
          console.log(`Found ${noFilterResponse.events.length} events without filter in ${logGroupName}`);
          for (const event of noFilterResponse.events) {
            // Log the first few events to see their format
            if (permissionDenials.length < 5) {
              console.log(`Sample event: ${event.message?.substring(0, 200)}...`);
            }
            
            const denial = this.parsePermissionDenial(event, logGroupName);
            if (denial) {
              permissionDenials.push(denial);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error searching for permission denials in ${logGroupName}:`, error);
    }

    // Filter by role patterns if specified
    if (rolePatterns && rolePatterns.length > 0) {
      const filteredDenials = permissionDenials.filter(denial => {
        // Check if the principal matches any of the role patterns
        return rolePatterns.some(pattern => {
          const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
          return regex.test(denial.principal);
        });
      });
      
      if (filteredDenials.length !== permissionDenials.length) {
        console.log(`🔍 Role pattern filtering: ${permissionDenials.length} → ${filteredDenials.length} denials in ${logGroupName}`);
      }
      
      return filteredDenials;
    }

    return permissionDenials;
  }

  private parsePermissionDenial(
    event: FilteredLogEvent,
    logGroupName: string
  ): PermissionDenial | null {
    if (!event.message || !event.timestamp || !event.logStreamName) {
      return null;
    }

    // Check if this message contains permission denial patterns
    const hasPermissionDenial = this.hasPermissionDenialPattern(event.message);
    if (!hasPermissionDenial) {
      return null;
    }

    try {
      // Try to parse as JSON first
      const parsedMessage = JSON.parse(event.message);

      return {
        timestamp: new Date(event.timestamp).toISOString(),
        logGroup: logGroupName,
        logStream: event.logStreamName || 'unknown',
        message: event.message,
        action: this.extractAction(parsedMessage, event.message),
        resource: this.extractResource(parsedMessage, event.message),
        principal: this.extractPrincipal(parsedMessage, event.message),
        errorCode: this.extractErrorCode(parsedMessage, event.message),
        sourceIp: parsedMessage.sourceIPAddress || parsedMessage.sourceIp || undefined,
        userAgent: parsedMessage.userAgent || undefined,
      };
    } catch {
      // If not JSON, parse as plain text
      return {
        timestamp: new Date(event.timestamp).toISOString(),
        logGroup: logGroupName,
        logStream: event.logStreamName || 'unknown',
        message: event.message,
        action: this.extractActionFromText(event.message),
        resource: this.extractResourceFromText(event.message),
        principal: this.extractPrincipalFromText(event.message),
        errorCode: this.extractErrorCodeFromText(event.message),
      };
    }
  }

  private hasPermissionDenialPattern(message: string): boolean {
    const denialPatterns = [
      /AccessDenied/i,
      /UnauthorizedOperation/i,
      /Forbidden/i,
      /not authorized/i,
      /permission denied/i,
      /access denied/i,
      /InvalidUserID\.NotFound/i,
      /InvalidAction/i,
      /CredentialsNotFound/i,
      /InvalidAccessKeyId/i,
      /SignatureDoesNotMatch/i,
      /TokenRefreshRequired/i,
      // Step Function specific patterns
      /User is not authorized to perform/i,
      /is not authorized to perform/i,
      /States\.TaskFailed/i,
      /States\.ExecutionFailed/i,
      /lambda:InvokeFunction/i,
      /User: .* is not authorized to perform: lambda:InvokeFunction/i,
      /User: .* is not authorized to perform: sns:Publish/i,
      /User: .* is not authorized to perform: sqs:SendMessage/i,
      /User: .* is not authorized to perform: dynamodb:/i,
      /User: .* is not authorized to perform: s3:/i,
      /User: .* is not authorized to perform: kms:/i,
    ];

    return denialPatterns.some(pattern => pattern.test(message));
  }

  private extractAction(parsedMessage: any, rawMessage: string): string {
    return (
      parsedMessage.eventName ||
      parsedMessage.action ||
      parsedMessage.operation ||
      this.extractActionFromText(rawMessage) ||
      'Unknown'
    );
  }

  private extractResource(parsedMessage: any, rawMessage: string): string {
    return (
      parsedMessage.resources?.[0]?.ARN ||
      parsedMessage.resourceARN ||
      parsedMessage.resource ||
      parsedMessage.bucketName ||
      parsedMessage.key ||
      this.extractResourceFromText(rawMessage) ||
      'Unknown'
    );
  }

  private extractPrincipal(parsedMessage: any, rawMessage: string): string {
    return (
      parsedMessage.userIdentity?.arn ||
      parsedMessage.userIdentity?.userName ||
      parsedMessage.principal ||
      parsedMessage.user ||
      this.extractPrincipalFromText(rawMessage) ||
      'Unknown'
    );
  }

  private extractErrorCode(parsedMessage: any, rawMessage: string): string {
    return (
      parsedMessage.errorCode ||
      parsedMessage.errorMessage ||
      parsedMessage.error ||
      this.extractErrorCodeFromText(rawMessage) ||
      'Unknown'
    );
  }

  private extractActionFromText(message: string): string {
    const actionPatterns = [
      /perform:\s*([a-zA-Z0-9:_-]+)/i,
      /perform\s+([a-zA-Z0-9:_-]+)/i,
      /action\s+([a-zA-Z0-9:_-]+)/i,
      /Action:\s*([^\s,]+)/i,
      /Operation:\s*([^\s,]+)/i,
      /EventName:\s*([^\s,]+)/i,
      /([a-zA-Z0-9]+:[a-zA-Z0-9]+)/,
    ];

    for (const pattern of actionPatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return 'Unknown';
  }

  private extractResourceFromText(message: string): string {
    const resourcePatterns = [
      /on resource:\s*(arn:aws:[^:\s]+:[^:\s]*:[^:\s]*:[^:\s]+:[^\s,]+)/i,
      /resource:\s*(arn:aws:[^:\s]+:[^:\s]*:[^:\s]*:[^:\s]+:[^\s,]+)/i,
      /on\s+(arn:aws:[^:\s]+:[^:\s]*:[^:\s]*:[^:\s]+:[^\s,]+)/i,
      /(arn:aws:[^:\s]+:[^:\s]*:[^:\s]*:[^:\s]+:[^\s,]+)/i,
      /on table\s+([^\s,]+)/i,
      /table\s+([^\s,]+)/i,
      /Resource:\s*([^\s,]+)/i,
      /Bucket:\s*([^\s,]+)/i,
      /Key:\s*([^\s,]+)/i,
    ];

    for (const pattern of resourcePatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        // For table resources, prepend "table " to match expected format
        if (pattern.source.includes('table') && !match[1].startsWith('table ')) {
          return `table ${match[1]}`;
        }
        return match[1];
      }
    }

    return 'Unknown';
  }

  private extractPrincipalFromText(message: string): string {
    const principalPatterns = [
      /User:\s*(arn:aws:iam::[^:\s]+:(user|role)\/[^\s,]+)/i,
      /Principal\s+(arn:aws:iam::[^:\s]+:(user|role)\/[^\s,]+)/i,
      /(arn:aws:iam::[^:\s]+:(user|role)\/[^\s,]+)/i,
      /for\s+(role\/[^\s,]+)/i,
      /User:\s*([^\s,]+)/i,
      /Role:\s*([^\s,]+)/i,
      /Principal:\s*([^\s,]+)/i,
    ];

    for (const pattern of principalPatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return 'Unknown';
  }

  private extractErrorCodeFromText(message: string): string {
    const errorPatterns = [
      /ErrorCode:\s*([^\s,]+)/i,
      /(AccessDenied)/i,
      /(UnauthorizedOperation)/i,
      /(Forbidden)/i,
      /(InvalidUserID\.NotFound)/i,
      /(InvalidAction)/i,
      /(NoSuchBucket)/i,
      /(NoSuchKey)/i,
      /(CredentialsNotFound)/i,
      /(InvalidAccessKeyId)/i,
      /(SignatureDoesNotMatch)/i,
      /(TokenRefreshRequired)/i,
    ];

    for (const pattern of errorPatterns) {
      const match = message.match(pattern);
      if (match) {
        return match[1] || match[0] || 'Unknown';
      }
    }

    // Check for common permission denial phrases that imply AccessDenied
    if (/not authorized/i.test(message) || /access denied/i.test(message)) {
      return 'AccessDenied';
    }

    return 'Unknown';
  }

  private findAssociatedResource(
    logGroupName: string,
    resources: CloudFormationResource[]
  ): CloudFormationResource | null {
    return resources.find(resource => resource.logGroups.includes(logGroupName)) || null;
  }
}
