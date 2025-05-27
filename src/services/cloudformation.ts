import {
  CloudFormationClient,
  DescribeStacksCommand,
  DescribeStackResourcesCommand,
  GetTemplateCommand,
  StackResource,
} from '@aws-sdk/client-cloudformation';
import { CloudFormationResource } from '../types/index.js';

export class CloudFormationService {
  private client: CloudFormationClient;

  constructor(region: string) {
    this.client = new CloudFormationClient({ region });
  }

  async getStackInfo(stackName: string): Promise<{ stackId: string; status: string }> {
    try {
      const command = new DescribeStacksCommand({ StackName: stackName });
      const response = await this.client.send(command);

      const stack = response.Stacks?.[0];
      if (!stack) {
        throw new Error(`Stack ${stackName} not found`);
      }

      return {
        stackId: stack.StackId || 'unknown',
        status: stack.StackStatus || 'unknown',
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get stack info for ${stackName}: ${error.message}`);
      }
      throw error;
    }
  }

  async getStackResources(stackName: string): Promise<CloudFormationResource[]> {
    try {
      const command = new DescribeStackResourcesCommand({ StackName: stackName });
      const response = await this.client.send(command);

      const resources = response.StackResources || [];
      const cfResources: CloudFormationResource[] = [];

      // Get the CloudFormation template to extract actual log group definitions
      const template = await this.getStackTemplate(stackName);

      for (const resource of resources) {
        if (!resource.LogicalResourceId || !resource.ResourceType) {
          continue;
        }

        const cfResource: CloudFormationResource = {
          logicalId: resource.LogicalResourceId,
          physicalId: resource.PhysicalResourceId || 'unknown',
          resourceType: resource.ResourceType,
          logGroups: [], // Will be populated from template analysis
          associatedRoles: this.getAssociatedRoles(resource),
          associatedPolicies: this.getAssociatedPolicies(resource),
        };

        cfResources.push(cfResource);
      }

      // Extract log groups from the template and assign them to resources
      if (template) {
        // For now, we'll add explicit log groups to their corresponding resources
        for (const cfResource of cfResources) {
          if (cfResource.resourceType === 'AWS::Logs::LogGroup') {
            cfResource.logGroups = [cfResource.physicalId];
          }
        }
      } else {
        // Fallback: If template retrieval fails (like in tests), still handle explicit log groups
        for (const cfResource of cfResources) {
          if (cfResource.resourceType === 'AWS::Logs::LogGroup') {
            cfResource.logGroups = [cfResource.physicalId];
          }
        }
      }

      return cfResources;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get stack resources for ${stackName}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get the CloudFormation template for a stack
   */
  async getStackTemplate(stackName: string): Promise<any> {
    try {
      const command = new GetTemplateCommand({ 
        StackName: stackName,
        TemplateStage: 'Processed' // Get the processed template with all transforms applied
      });
      const response = await this.client.send(command);
      
      if (response.TemplateBody) {
        return typeof response.TemplateBody === 'string' 
          ? JSON.parse(response.TemplateBody)
          : response.TemplateBody;
      }
      
      return null;
    } catch (error) {
      console.warn(`Could not retrieve template for stack ${stackName}:`, error);
      return null;
    }
  }

  /**
   * Extract log groups from the CloudFormation template.
   * This is the CORRECT approach - read what's actually defined instead of guessing.
   */
  private extractLogGroupsFromTemplate(template: any, resources: CloudFormationResource[]): string[] {
    const logGroups: string[] = [];
    
    if (!template || !template.Resources) {
      return logGroups;
    }

    // 1. Find explicit AWS::Logs::LogGroup resources
    for (const [logicalId, resource] of Object.entries(template.Resources as Record<string, any>)) {
      if (resource.Type === 'AWS::Logs::LogGroup') {
        // Find the physical resource to get the actual log group name
        const physicalResource = resources.find(r => r.logicalId === logicalId);
        if (physicalResource?.physicalId && physicalResource.physicalId !== 'unknown') {
          logGroups.push(physicalResource.physicalId);
        } else if (resource.Properties?.LogGroupName) {
          // Fallback to template-defined name if physical ID not available
          logGroups.push(resource.Properties.LogGroupName);
        }
      }
    }

    // 2. Find log groups referenced in resource properties
    for (const [logicalId, resource] of Object.entries(template.Resources as Record<string, any>)) {
      const resourceLogGroups = this.extractLogGroupReferencesFromResource(resource, logicalId, resources);
      logGroups.push(...resourceLogGroups);
    }

    return Array.from(new Set(logGroups)); // Remove duplicates
  }

  /**
   * Extract log group references from specific resource properties
   */
  private extractLogGroupReferencesFromResource(
    resource: any, 
    _logicalId: string, 
    _stackResources: CloudFormationResource[]
  ): string[] {
    const logGroups: string[] = [];
    
    if (!resource.Properties) {
      return logGroups;
    }

         const props = resource.Properties;

    switch (resource.Type) {
      case 'AWS::Lambda::Function':
        // Check if the Lambda function has explicit log group configuration
        if (props.LoggingConfig?.LogGroup) {
          logGroups.push(props.LoggingConfig.LogGroup);
        }
        // Note: We DON'T automatically assume /aws/lambda/{name} exists anymore
        break;

      case 'AWS::ECS::TaskDefinition':
        // Check container definitions for awslogs log driver
        if (props.ContainerDefinitions) {
          for (const container of props.ContainerDefinitions) {
            if (container.LogConfiguration?.LogDriver === 'awslogs') {
              const logGroupName = container.LogConfiguration.Options?.['awslogs-group'];
              if (logGroupName) {
                logGroups.push(logGroupName);
              }
            }
          }
        }
        break;

      case 'AWS::StepFunctions::StateMachine':
        // Check for logging configuration
        if (props.LoggingConfiguration?.Destinations) {
          for (const destination of props.LoggingConfiguration.Destinations) {
            if (destination.CloudWatchLogsLogGroup?.LogGroupArn) {
              // Extract log group name from ARN
              const arnParts = destination.CloudWatchLogsLogGroup.LogGroupArn.split(':');
              if (arnParts.length >= 6) {
                logGroups.push(arnParts[6]); // Log group name is the 7th part (index 6)
              }
            }
          }
        }
        break;

      case 'AWS::ApiGateway::Stage':
        // Check for access logging configuration
        if (props.AccessLogDestinationArn) {
          // Extract log group name from CloudWatch Logs ARN
          const arnParts = props.AccessLogDestinationArn.split(':');
          if (arnParts.length >= 6 && arnParts[2] === 'logs') {
            logGroups.push(arnParts[6]);
          }
        }
        break;

      case 'AWS::CodeBuild::Project':
        // Check for logs configuration
        if (props.LogsConfig?.CloudWatchLogs?.GroupName) {
          logGroups.push(props.LogsConfig.CloudWatchLogs.GroupName);
        }
        break;

      case 'AWS::CloudTrail::Trail':
        // Check for CloudWatch logs configuration
        if (props.CloudWatchLogsLogGroupArn) {
          const arnParts = props.CloudWatchLogsLogGroupArn.split(':');
          if (arnParts.length >= 6) {
            logGroups.push(arnParts[6]);
          }
        }
        break;

      default:
        // For other resource types, look for common log group property patterns
        this.extractGenericLogGroupReferences(props, logGroups);
        break;
    }

    return logGroups;
  }

  /**
   * Extract log group references from generic properties
   */
  private extractGenericLogGroupReferences(properties: any, logGroups: string[]): void {
    const logGroupPatterns = [
      /^\/aws\/[a-zA-Z0-9\-_\/]+$/,
      /^\/custom\/[a-zA-Z0-9\-_\/]+$/,
      /^[a-zA-Z0-9\-_\/]+$/
    ];

    const searchForLogGroups = (obj: any, depth = 0): void => {
      if (depth > 5 || !obj || typeof obj !== 'object') return;

      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          // Check if the key suggests it's a log group
          const keyLower = key.toLowerCase();
          if (keyLower.includes('loggroup') || keyLower.includes('log-group') || 
              keyLower === 'logdestination' || keyLower === 'loggroupname') {
            if (logGroupPatterns.some(pattern => pattern.test(value))) {
              logGroups.push(value);
            }
          }
        } else if (typeof value === 'object') {
          searchForLogGroups(value, depth + 1);
        }
      }
    };

    searchForLogGroups(properties);
  }

  private getAssociatedRoles(resource: StackResource): string[] {
    const roles: string[] = [];
    const resourceType = resource.ResourceType;
    const logicalResourceId = resource.LogicalResourceId;

    if (!resourceType || !logicalResourceId) {
      return roles;
    }

    // Common resource types that typically have IAM roles
    const roleBasedResources = [
      'AWS::Lambda::Function',
      'AWS::ECS::Service',
      'AWS::ECS::TaskDefinition',
      'AWS::CodeBuild::Project',
      'AWS::StepFunctions::StateMachine',
      'AWS::ApiGateway::RestApi',
      'AWS::ElasticBeanstalk::Application',
    ];

    if (roleBasedResources.includes(resourceType)) {
      // These would typically require additional API calls to get the actual role ARNs
      // For now, we'll note that these resources likely have associated roles
      roles.push(`${logicalResourceId}-ExecutionRole`);
    }

    return roles;
  }

  private getAssociatedPolicies(_resource: StackResource): string[] {
    const policies: string[] = [];

    // This would require additional analysis of the CloudFormation template
    // or calls to other AWS APIs to determine the actual policies
    // For now, we'll return an empty array

    return policies;
  }

  /**
   * Get all log groups defined in the CloudFormation stack.
   * This uses the CORRECT approach: reading the actual template instead of guessing.
   */
  async getStackLogGroups(stackName: string): Promise<{
    explicit: string[];
    referenced: string[];
    all: string[];
  }> {
    const resources = await this.getStackResources(stackName);
    const template = await this.getStackTemplate(stackName);
    
    const explicitLogGroups: string[] = [];
    const referencedLogGroups: string[] = [];
    
    if (template) {
      // Get all log groups from the template
      const templateLogGroups = this.extractLogGroupsFromTemplate(template, resources);
      
      // Separate explicit AWS::Logs::LogGroup resources from referenced ones
      for (const [logicalId, resource] of Object.entries(template.Resources as Record<string, any>)) {
        if (resource.Type === 'AWS::Logs::LogGroup') {
          const physicalResource = resources.find(r => r.logicalId === logicalId);
          if (physicalResource?.physicalId && physicalResource.physicalId !== 'unknown') {
            explicitLogGroups.push(physicalResource.physicalId);
          } else if (resource.Properties?.LogGroupName) {
            explicitLogGroups.push(resource.Properties.LogGroupName);
          }
        }
      }
      
      // All other log groups are referenced in resource properties
      referencedLogGroups.push(...templateLogGroups.filter(lg => !explicitLogGroups.includes(lg)));
    }
    
    // Combine and deduplicate
    const allLogGroups = Array.from(new Set([...explicitLogGroups, ...referencedLogGroups]));
    
    return {
      explicit: explicitLogGroups,
      referenced: referencedLogGroups,
      all: allLogGroups
    };
  }
}
