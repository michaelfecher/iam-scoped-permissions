import { CloudFormationService } from '../src/services/cloudformation.js';

// Mock AWS SDK
jest.mock('@aws-sdk/client-cloudformation', () => ({
  CloudFormationClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  DescribeStacksCommand: jest.fn(),
  DescribeStackResourcesCommand: jest.fn(),
}));

describe('CloudFormationService', () => {
  let service: CloudFormationService;
  let mockClient: any;

  beforeEach(() => {
    const { CloudFormationClient } = require('@aws-sdk/client-cloudformation');
    mockClient = {
      send: jest.fn(),
    };
    CloudFormationClient.mockImplementation(() => mockClient);
    
    service = new CloudFormationService('us-east-1');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getStackInfo', () => {
    it('should retrieve stack information successfully', async () => {
      const mockStackData = {
        Stacks: [
          {
            StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/12345',
            StackName: 'test-stack',
            StackStatus: 'CREATE_COMPLETE',
            CreationTime: new Date(),
          },
        ],
      };

      mockClient.send.mockResolvedValue(mockStackData);

      const result = await service.getStackInfo('test-stack');

      expect(result).toEqual({
        stackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/12345',
        status: 'CREATE_COMPLETE',
      });
    });

    it('should throw error when stack not found', async () => {
      mockClient.send.mockResolvedValue({ Stacks: [] });

      await expect(service.getStackInfo('non-existent-stack')).rejects.toThrow(
        'Stack non-existent-stack not found'
      );
    });

    it('should throw error when API call fails', async () => {
      mockClient.send.mockRejectedValue(new Error('API Error'));

      await expect(service.getStackInfo('test-stack')).rejects.toThrow('API Error');
    });
  });

  describe('getStackResources', () => {
    it('should retrieve and map Lambda function resources correctly', async () => {
      const mockResourcesData = {
        StackResources: [
          {
            LogicalResourceId: 'TestFunction',
            PhysicalResourceId: 'test-function-12345',
            ResourceType: 'AWS::Lambda::Function',
            ResourceStatus: 'CREATE_COMPLETE',
          },
        ],
      };

      mockClient.send.mockResolvedValue(mockResourcesData);

      const result = await service.getStackResources('test-stack');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        logicalId: 'TestFunction',
        physicalId: 'test-function-12345',
        resourceType: 'AWS::Lambda::Function',
        logGroups: ['/aws/lambda/test-function-12345'],
      });
    });

    it('should retrieve and map API Gateway resources correctly', async () => {
      const mockResourcesData = {
        StackResources: [
          {
            LogicalResourceId: 'TestApi',
            PhysicalResourceId: 'abc123',
            ResourceType: 'AWS::ApiGateway::RestApi',
            ResourceStatus: 'CREATE_COMPLETE',
          },
        ],
      };

      mockClient.send.mockResolvedValue(mockResourcesData);

      const result = await service.getStackResources('test-stack');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        logicalId: 'TestApi',
        physicalId: 'abc123',
        resourceType: 'AWS::ApiGateway::RestApi',
        logGroups: [
          '/aws/apigateway/abc123',
          'API-Gateway-Execution-Logs_abc123/prod',
          'API-Gateway-Execution-Logs_abc123/stage',
        ],
      });
    });

    it('should retrieve and map Step Functions resources correctly', async () => {
      const mockResourcesData = {
        StackResources: [
          {
            LogicalResourceId: 'TestStateMachine',
            PhysicalResourceId: 'arn:aws:states:us-east-1:123456789012:stateMachine:test-state-machine',
            ResourceType: 'AWS::StepFunctions::StateMachine',
            ResourceStatus: 'CREATE_COMPLETE',
          },
        ],
      };

      mockClient.send.mockResolvedValue(mockResourcesData);

      const result = await service.getStackResources('test-stack');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        logicalId: 'TestStateMachine',
        physicalId: 'arn:aws:states:us-east-1:123456789012:stateMachine:test-state-machine',
        resourceType: 'AWS::StepFunctions::StateMachine',
        logGroups: ['/aws/stepfunctions/arn:aws:states:us-east-1:123456789012:stateMachine:test-state-machine'],
      });
    });

    it('should retrieve and map ECS service resources correctly', async () => {
      const mockResourcesData = {
        StackResources: [
          {
            LogicalResourceId: 'TestService',
            PhysicalResourceId: 'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service',
            ResourceType: 'AWS::ECS::Service',
            ResourceStatus: 'CREATE_COMPLETE',
          },
          {
            LogicalResourceId: 'TestTaskDefinition',
            PhysicalResourceId: 'test-task-def',
            ResourceType: 'AWS::ECS::TaskDefinition',
            ResourceStatus: 'CREATE_COMPLETE',
          },
        ],
      };

      mockClient.send.mockResolvedValue(mockResourcesData);

      const result = await service.getStackResources('test-stack');

      expect(result).toHaveLength(2);
      
      const ecsService = result.find(r => r.resourceType === 'AWS::ECS::Service');
      expect(ecsService?.logGroups).toEqual([
        '/ecs/arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service',
        '/aws/ecs/arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service',
      ]);
      
      const taskDef = result.find(r => r.resourceType === 'AWS::ECS::TaskDefinition');
      expect(taskDef?.logGroups).toEqual([
        '/ecs/test-task-def',
        '/aws/ecs/test-task-def',
      ]);
    });

    it('should retrieve and map RDS resources correctly', async () => {
      const mockResourcesData = {
        StackResources: [
          {
            LogicalResourceId: 'TestDatabase',
            PhysicalResourceId: 'test-db-instance',
            ResourceType: 'AWS::RDS::DBInstance',
            ResourceStatus: 'CREATE_COMPLETE',
          },
          {
            LogicalResourceId: 'TestCluster',
            PhysicalResourceId: 'test-cluster',
            ResourceType: 'AWS::RDS::DBCluster',
            ResourceStatus: 'CREATE_COMPLETE',
          },
        ],
      };

      mockClient.send.mockResolvedValue(mockResourcesData);

      const result = await service.getStackResources('test-stack');

      expect(result).toHaveLength(2);
      
      const dbInstance = result.find(r => r.resourceType === 'AWS::RDS::DBInstance');
      expect(dbInstance?.logGroups).toEqual([
        '/aws/rds/instance/test-db-instance/error',
        '/aws/rds/instance/test-db-instance/general',
        '/aws/rds/instance/test-db-instance/slowquery',
      ]);
      
      const cluster = result.find(r => r.resourceType === 'AWS::RDS::DBCluster');
      expect(cluster?.logGroups).toEqual([
        '/aws/rds/instance/test-cluster/error',
        '/aws/rds/instance/test-cluster/general',
        '/aws/rds/instance/test-cluster/slowquery',
      ]);
    });

    it('should handle custom log groups correctly', async () => {
      const mockResourcesData = {
        StackResources: [
          {
            LogicalResourceId: 'CustomLogGroup',
            PhysicalResourceId: '/custom/log/group',
            ResourceType: 'AWS::Logs::LogGroup',
            ResourceStatus: 'CREATE_COMPLETE',
          },
        ],
      };

      mockClient.send.mockResolvedValue(mockResourcesData);

      const result = await service.getStackResources('test-stack');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        logicalId: 'CustomLogGroup',
        physicalId: '/custom/log/group',
        resourceType: 'AWS::Logs::LogGroup',
        logGroups: ['/custom/log/group'],
      });
    });

    it('should handle resources with no log groups', async () => {
      const mockResourcesData = {
        StackResources: [
          {
            LogicalResourceId: 'TestS3Bucket',
            PhysicalResourceId: 'test-bucket-12345',
            ResourceType: 'AWS::S3::Bucket',
            ResourceStatus: 'CREATE_COMPLETE',
          },
        ],
      };

      mockClient.send.mockResolvedValue(mockResourcesData);

      const result = await service.getStackResources('test-stack');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        logicalId: 'TestS3Bucket',
        physicalId: 'test-bucket-12345',
        resourceType: 'AWS::S3::Bucket',
        logGroups: ['/aws/s3/test-bucket-12345'],
      });
    });

    it('should handle multiple resources of the same type', async () => {
      const mockResourcesData = {
        StackResources: [
          {
            LogicalResourceId: 'Function1',
            PhysicalResourceId: 'function-1',
            ResourceType: 'AWS::Lambda::Function',
            ResourceStatus: 'CREATE_COMPLETE',
          },
          {
            LogicalResourceId: 'Function2',
            PhysicalResourceId: 'function-2',
            ResourceType: 'AWS::Lambda::Function',
            ResourceStatus: 'CREATE_COMPLETE',
          },
        ],
      };

      mockClient.send.mockResolvedValue(mockResourcesData);

      const result = await service.getStackResources('test-stack');

      expect(result).toHaveLength(2);
      expect(result[0]?.logGroups).toEqual(['/aws/lambda/function-1']);
      expect(result[1]?.logGroups).toEqual(['/aws/lambda/function-2']);
    });

    it('should throw error when API call fails', async () => {
      mockClient.send.mockRejectedValue(new Error('API Error'));

      await expect(service.getStackResources('test-stack')).rejects.toThrow('API Error');
    });
  });

  describe('getLogGroupsForResource', () => {
    it('should return correct log groups for Lambda functions', () => {
      const service = new CloudFormationService('us-east-1');
      const getLogGroups = (service as any).getLogGroupsForResource.bind(service);

      const mockResource = {
        ResourceType: 'AWS::Lambda::Function',
        PhysicalResourceId: 'test-function',
        LogicalResourceId: 'TestFunction',
      };

      const result = getLogGroups(mockResource);
      expect(result).toEqual(['/aws/lambda/test-function']);
    });

    it('should return correct log groups for API Gateway', () => {
      const service = new CloudFormationService('us-east-1');
      const getLogGroups = (service as any).getLogGroupsForResource.bind(service);

      const mockResource = {
        ResourceType: 'AWS::ApiGateway::RestApi',
        PhysicalResourceId: 'api123',
        LogicalResourceId: 'TestApi',
      };

      const result = getLogGroups(mockResource);
      expect(result).toEqual([
        '/aws/apigateway/api123',
        'API-Gateway-Execution-Logs_api123/prod',
        'API-Gateway-Execution-Logs_api123/stage',
      ]);
    });

    it('should return correct log groups for Step Functions', () => {
      const service = new CloudFormationService('us-east-1');
      const getLogGroups = (service as any).getLogGroupsForResource.bind(service);

      const mockResource = {
        ResourceType: 'AWS::StepFunctions::StateMachine',
        PhysicalResourceId: 'arn:aws:states:us-east-1:123456789012:stateMachine:test-machine',
        LogicalResourceId: 'TestStateMachine',
      };

      const result = getLogGroups(mockResource);
      expect(result).toEqual(['/aws/stepfunctions/arn:aws:states:us-east-1:123456789012:stateMachine:test-machine']);
    });

    it('should return correct log groups for ECS services', () => {
      const service = new CloudFormationService('us-east-1');
      const getLogGroups = (service as any).getLogGroupsForResource.bind(service);

      const mockResource = {
        ResourceType: 'AWS::ECS::Service',
        PhysicalResourceId: 'arn:aws:ecs:us-east-1:123456789012:service/cluster/service',
        LogicalResourceId: 'TestService',
      };

      const result = getLogGroups(mockResource);
      expect(result).toEqual([
        '/ecs/arn:aws:ecs:us-east-1:123456789012:service/cluster/service',
        '/aws/ecs/arn:aws:ecs:us-east-1:123456789012:service/cluster/service',
      ]);
    });

    it('should return correct log groups for RDS instances', () => {
      const service = new CloudFormationService('us-east-1');
      const getLogGroups = (service as any).getLogGroupsForResource.bind(service);

      const mockResource = {
        ResourceType: 'AWS::RDS::DBInstance',
        PhysicalResourceId: 'test-db',
        LogicalResourceId: 'TestDatabase',
      };

      const result = getLogGroups(mockResource);
      expect(result).toEqual([
        '/aws/rds/instance/test-db/error',
        '/aws/rds/instance/test-db/general',
        '/aws/rds/instance/test-db/slowquery',
      ]);
    });

    it('should return inferred log groups for unsupported resource types', () => {
      const service = new CloudFormationService('us-east-1');
      const getLogGroups = (service as any).getLogGroupsForResource.bind(service);

      const mockResource = {
        ResourceType: 'AWS::S3::Bucket',
        PhysicalResourceId: 'test-bucket',
        LogicalResourceId: 'TestBucket',
      };

      const result = getLogGroups(mockResource);
      expect(result).toEqual(['/aws/s3/test-bucket']);
    });

    it('should handle null or undefined physical IDs', () => {
      const service = new CloudFormationService('us-east-1');
      const getLogGroups = (service as any).getLogGroupsForResource.bind(service);

      const mockResource1 = {
        ResourceType: 'AWS::Lambda::Function',
        PhysicalResourceId: null,
        LogicalResourceId: 'TestFunction',
      };

      const mockResource2 = {
        ResourceType: 'AWS::Lambda::Function',
        PhysicalResourceId: undefined,
        LogicalResourceId: 'TestFunction',
      };

      const result1 = getLogGroups(mockResource1);
      expect(result1).toEqual([]);

      const result2 = getLogGroups(mockResource2);
      expect(result2).toEqual([]);
    });
  });


}); 