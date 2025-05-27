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

  async analyzeLogGroups(
    logGroupNames: string[],
    resources: CloudFormationResource[],
    lookbackDays: number = 7,
    maxEvents: number = 1000
  ): Promise<LogAnalysisResult[]> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const results: LogAnalysisResult[] = [];

    for (const logGroupName of logGroupNames) {
      try {
        const logGroupExists = await this.checkLogGroupExists(logGroupName);
        if (!logGroupExists) {
          console.warn(`Log group ${logGroupName} does not exist, skipping...`);
          continue;
        }

        const permissionDenials = await this.searchPermissionDenials(
          logGroupName,
          startTime,
          endTime,
          maxEvents
        );

        const associatedResource = this.findAssociatedResource(logGroupName, resources);

        results.push({
          logGroupName,
          associatedResource,
          permissionDenials,
          totalEvents: permissionDenials.length,
          timeRange: { start: startTime, end: endTime },
        });
      } catch (error) {
        console.error(`Error analyzing log group ${logGroupName}:`, error);
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
    maxEvents: number
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
