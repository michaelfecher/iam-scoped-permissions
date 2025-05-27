import {
  CloudFormationClient,
  DescribeStacksCommand,
  DescribeStackResourcesCommand,
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

      for (const resource of resources) {
        if (!resource.LogicalResourceId || !resource.ResourceType) {
          continue;
        }

        const cfResource: CloudFormationResource = {
          logicalId: resource.LogicalResourceId,
          physicalId: resource.PhysicalResourceId || 'unknown',
          resourceType: resource.ResourceType,
          logGroups: this.getLogGroupsForResource(resource),
          associatedRoles: this.getAssociatedRoles(resource),
          associatedPolicies: this.getAssociatedPolicies(resource),
        };

        cfResources.push(cfResource);
      }

      return cfResources;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get stack resources for ${stackName}: ${error.message}`);
      }
      throw error;
    }
  }

  private getLogGroupsForResource(resource: StackResource): string[] {
    const logGroups: string[] = [];
    const resourceType = resource.ResourceType;
    const physicalId = resource.PhysicalResourceId;

    if (!physicalId || !resourceType) {
      return logGroups;
    }

    switch (resourceType) {
      case 'AWS::Lambda::Function':
        // Lambda functions have log groups in the format /aws/lambda/{function-name}
        logGroups.push(`/aws/lambda/${physicalId}`);
        break;

      case 'AWS::ApiGateway::RestApi':
        // API Gateway REST APIs have log groups in various formats
        logGroups.push(`/aws/apigateway/${physicalId}`);
        logGroups.push(`API-Gateway-Execution-Logs_${physicalId}/prod`);
        logGroups.push(`API-Gateway-Execution-Logs_${physicalId}/stage`);
        break;

      case 'AWS::ApiGatewayV2::Api':
        // API Gateway V2 (HTTP APIs)
        logGroups.push(`/aws/apigateway/${physicalId}`);
        break;

      case 'AWS::StepFunctions::StateMachine':
        // Step Functions state machines
        logGroups.push(`/aws/stepfunctions/${physicalId}`);
        break;

      case 'AWS::ECS::Service':
      case 'AWS::ECS::TaskDefinition':
        // ECS services and task definitions
        logGroups.push(`/ecs/${physicalId}`);
        logGroups.push(`/aws/ecs/${physicalId}`);
        break;

      case 'AWS::RDS::DBInstance':
      case 'AWS::RDS::DBCluster':
        // RDS instances and clusters
        logGroups.push(`/aws/rds/instance/${physicalId}/error`);
        logGroups.push(`/aws/rds/instance/${physicalId}/general`);
        logGroups.push(`/aws/rds/instance/${physicalId}/slowquery`);
        break;

      case 'AWS::ElasticBeanstalk::Application':
      case 'AWS::ElasticBeanstalk::Environment':
        // Elastic Beanstalk
        logGroups.push(`/aws/elasticbeanstalk/${physicalId}`);
        break;

      case 'AWS::CodeBuild::Project':
        // CodeBuild projects
        logGroups.push(`/aws/codebuild/${physicalId}`);
        break;

      case 'AWS::Batch::JobDefinition':
      case 'AWS::Batch::JobQueue':
        // AWS Batch
        logGroups.push(`/aws/batch/job`);
        break;

      case 'AWS::Logs::LogGroup':
        // Explicitly defined log groups
        logGroups.push(physicalId);
        break;

      case 'AWS::EC2::Instance':
        // EC2 instances (if CloudWatch agent is configured)
        logGroups.push(`/aws/ec2/${physicalId}`);
        logGroups.push(`/var/log/messages`);
        logGroups.push(`/var/log/secure`);
        break;

      case 'AWS::EKS::Cluster':
        // EKS clusters
        logGroups.push(`/aws/eks/${physicalId}/cluster`);
        break;

      default: {
        // For unknown resource types, try to infer log group names
        // based on common patterns
        const lowerResourceType = resourceType.toLowerCase();
        const serviceName = lowerResourceType.split('::')[1];

        if (serviceName) {
          logGroups.push(`/aws/${serviceName}/${physicalId}`);
        }
        break;
      }
    }

    return logGroups;
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
}
