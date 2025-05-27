import { CloudWatchLogsService } from '../src/services/cloudwatch-logs.js';
import { CloudFormationResource } from '../src/types/index.js';

// Mock AWS SDK
jest.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  DescribeLogGroupsCommand: jest.fn(),
  FilterLogEventsCommand: jest.fn(),
}));

describe('CloudWatchLogsService', () => {
  let service: CloudWatchLogsService;
  let mockClient: any;

  beforeEach(() => {
    const { CloudWatchLogsClient } = require('@aws-sdk/client-cloudwatch-logs');
    mockClient = {
      send: jest.fn(),
    };
    CloudWatchLogsClient.mockImplementation(() => mockClient);
    
    service = new CloudWatchLogsService('us-east-1');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeLogGroups', () => {
    it('should analyze log groups and return permission denials', async () => {
      const mockResources: CloudFormationResource[] = [
        {
          logicalId: 'TestFunction',
          physicalId: 'test-function',
          resourceType: 'AWS::Lambda::Function',
          logGroups: ['/aws/lambda/test-function'],
        },
      ];

      const logGroups = ['/aws/lambda/test-function'];

      // Mock checkLogGroupExists to return true, then mock log events
      mockClient.send
        .mockResolvedValueOnce({
          logGroups: [{ logGroupName: '/aws/lambda/test-function' }],
        })
        .mockResolvedValueOnce({
          events: [
            {
              timestamp: Date.now(),
              logStreamName: 'test-stream',
              message: 'User: arn:aws:iam::123456789012:role/test-role is not authorized to perform: s3:GetObject on resource: arn:aws:s3:::test-bucket/file.txt',
            },
            {
              timestamp: Date.now(),
              logStreamName: 'test-stream',
              message: 'AccessDenied: User is not authorized to perform dynamodb:PutItem on table test-table',
            },
          ],
        });

      const result = await service.analyzeLogGroups(logGroups, mockResources, 7, 1000);

      expect(result).toHaveLength(1);
      expect(result[0]?.logGroupName).toBe('/aws/lambda/test-function');
      expect(result[0]?.permissionDenials).toHaveLength(2);
    });

    it('should handle log groups with no permission denials', async () => {
      const mockResources: CloudFormationResource[] = [];
      const logGroups = ['/aws/lambda/test-function'];

      mockClient.send
        .mockResolvedValueOnce({
          logGroups: [{ logGroupName: '/aws/lambda/test-function' }],
        })
        .mockResolvedValueOnce({
          events: [
            {
              timestamp: Date.now(),
              logStreamName: 'test-stream',
              message: 'INFO: Function executed successfully',
            },
          ],
        });

      const result = await service.analyzeLogGroups(logGroups, mockResources, 7, 1000);

      expect(result).toHaveLength(1);
      expect(result[0]?.permissionDenials).toHaveLength(0);
    });

    it('should associate resources correctly', async () => {
      const mockResources: CloudFormationResource[] = [
        {
          logicalId: 'TestFunction',
          physicalId: 'test-function',
          resourceType: 'AWS::Lambda::Function',
          logGroups: ['/aws/lambda/test-function'],
        },
      ];

      const logGroups = ['/aws/lambda/test-function'];

      mockClient.send
        .mockResolvedValueOnce({
          logGroups: [{ logGroupName: '/aws/lambda/test-function' }],
        })
        .mockResolvedValueOnce({
          events: [],
        });

      const result = await service.analyzeLogGroups(logGroups, mockResources, 7, 1000);

      expect(result[0]?.associatedResource).toEqual(mockResources[0]);
    });

    it('should handle multiple log groups', async () => {
      const mockResources: CloudFormationResource[] = [
        {
          logicalId: 'TestFunction1',
          physicalId: 'test-function-1',
          resourceType: 'AWS::Lambda::Function',
          logGroups: ['/aws/lambda/test-function-1'],
        },
        {
          logicalId: 'TestFunction2',
          physicalId: 'test-function-2',
          resourceType: 'AWS::Lambda::Function',
          logGroups: ['/aws/lambda/test-function-2'],
        },
      ];

      const logGroups = ['/aws/lambda/test-function-1', '/aws/lambda/test-function-2'];

      mockClient.send
        .mockResolvedValueOnce({
          logGroups: [{ logGroupName: '/aws/lambda/test-function-1' }],
        })
        .mockResolvedValueOnce({
          events: [],
        })
        .mockResolvedValueOnce({
          logGroups: [{ logGroupName: '/aws/lambda/test-function-2' }],
        })
        .mockResolvedValueOnce({
          events: [],
        });

      const result = await service.analyzeLogGroups(logGroups, mockResources, 7, 1000);

      expect(result).toHaveLength(2);
      expect(result[0]?.logGroupName).toBe('/aws/lambda/test-function-1');
      expect(result[1]?.logGroupName).toBe('/aws/lambda/test-function-2');
    });

    it('should handle API errors gracefully', async () => {
      const mockResources: CloudFormationResource[] = [];
      const logGroups = ['/aws/lambda/test-function'];

      mockClient.send.mockRejectedValue(new Error('LogGroup not found'));

      const result = await service.analyzeLogGroups(logGroups, mockResources, 7, 1000);

      expect(result).toHaveLength(0);
    });
  });

  describe('parsePermissionDenial', () => {
    it('should parse standard AccessDenied errors', () => {
      const service = new CloudWatchLogsService('us-east-1');
      const parseMethod = (service as any).parsePermissionDenial.bind(service);

      const logEvent = {
        timestamp: Date.now(),
        logStreamName: 'test-stream',
        message: 'User: arn:aws:iam::123456789012:role/test-role is not authorized to perform: s3:GetObject on resource: arn:aws:s3:::test-bucket/file.txt',
      };

      const denial = parseMethod(logEvent, '/aws/lambda/test-function');

      expect(denial).toMatchObject({
        action: 's3:GetObject',
        resource: 'arn:aws:s3:::test-bucket/file.txt',
        principal: 'arn:aws:iam::123456789012:role/test-role',
        errorCode: 'AccessDenied',
      });
    });

    it('should parse UnauthorizedOperation errors', () => {
      const service = new CloudWatchLogsService('us-east-1');
      const parseMethod = (service as any).parsePermissionDenial.bind(service);

      const logEvent = {
        timestamp: Date.now(),
        logStreamName: 'test-stream',
        message: 'UnauthorizedOperation: You are not authorized to perform this operation.',
      };

      const denial = parseMethod(logEvent, '/aws/lambda/test-function');

      expect(denial).toMatchObject({
        errorCode: 'UnauthorizedOperation',
      });
    });

    it('should parse Forbidden errors', () => {
      const service = new CloudWatchLogsService('us-east-1');
      const parseMethod = (service as any).parsePermissionDenial.bind(service);

      const logEvent = {
        timestamp: Date.now(),
        logStreamName: 'test-stream',
        message: 'Forbidden: Access denied to dynamodb:Query on table users',
      };

      const denial = parseMethod(logEvent, '/aws/lambda/test-function');

      expect(denial).toMatchObject({
        action: 'dynamodb:Query',
        resource: 'table users',
        errorCode: 'Forbidden',
      });
    });

    it('should parse JSON formatted log messages', () => {
      const service = new CloudWatchLogsService('us-east-1');
      const parseMethod = (service as any).parsePermissionDenial.bind(service);

      const logEvent = {
        timestamp: Date.now(),
        logStreamName: 'test-stream',
        message: JSON.stringify({
          level: 'ERROR',
          message: 'AccessDenied: User is not authorized to perform s3:PutObject',
          timestamp: '2024-01-01T00:00:00Z',
        }),
      };

      const denial = parseMethod(logEvent, '/aws/lambda/test-function');

      expect(denial).toMatchObject({
        action: 's3:PutObject',
        errorCode: 'AccessDenied',
      });
    });

    it('should handle malformed messages gracefully', () => {
      const service = new CloudWatchLogsService('us-east-1');
      const parseMethod = (service as any).parsePermissionDenial.bind(service);

      const logEvent = {
        timestamp: Date.now(),
        logStreamName: 'test-stream',
        message: 'Some random log message without permission denial',
      };

      const denial = parseMethod(logEvent, '/aws/lambda/test-function');

      expect(denial).toBeNull();
    });

    it('should extract principals from different formats', () => {
      const service = new CloudWatchLogsService('us-east-1');
      const parseMethod = (service as any).parsePermissionDenial.bind(service);

      const testCases = [
        {
          message: 'User: arn:aws:iam::123456789012:role/test-role is not authorized',
          expectedPrincipal: 'arn:aws:iam::123456789012:role/test-role',
        },
        {
          message: 'Principal arn:aws:iam::123456789012:user/test-user access denied',
          expectedPrincipal: 'arn:aws:iam::123456789012:user/test-user',
        },
        {
          message: 'AccessDenied for role/lambda-execution-role',
          expectedPrincipal: 'role/lambda-execution-role',
        },
      ];

      testCases.forEach(testCase => {
        const logEvent = {
          timestamp: Date.now(),
          logStreamName: 'test-stream',
          message: testCase.message,
        };

        const denial = parseMethod(logEvent, '/aws/lambda/test-function');
        
        if (denial) {
          expect(denial.principal).toBe(testCase.expectedPrincipal);
        }
      });
    });

    it('should extract actions from different formats', () => {
      const service = new CloudWatchLogsService('us-east-1');
      const parseMethod = (service as any).parsePermissionDenial.bind(service);

      const testCases = [
        {
          message: 'not authorized to perform: s3:GetObject on resource',
          expectedAction: 's3:GetObject',
        },
        {
          message: 'perform dynamodb:PutItem on table',
          expectedAction: 'dynamodb:PutItem',
        },
        {
          message: 'action lambda:InvokeFunction denied',
          expectedAction: 'lambda:InvokeFunction',
        },
      ];

      testCases.forEach(testCase => {
        const logEvent = {
          timestamp: Date.now(),
          logStreamName: 'test-stream',
          message: testCase.message,
        };

        const denial = parseMethod(logEvent, '/aws/lambda/test-function');
        
        if (denial) {
          expect(denial.action).toBe(testCase.expectedAction);
        }
      });
    });

    it('should extract resources from different formats', () => {
      const service = new CloudWatchLogsService('us-east-1');
      const parseMethod = (service as any).parsePermissionDenial.bind(service);

      const testCases = [
        {
          message: 'on resource: arn:aws:s3:::test-bucket/file.txt',
          expectedResource: 'arn:aws:s3:::test-bucket/file.txt',
        },
        {
          message: 'on table test-users',
          expectedResource: 'table test-users',
        },
        {
          message: 'resource arn:aws:lambda:us-east-1:123456789012:function:test',
          expectedResource: 'arn:aws:lambda:us-east-1:123456789012:function:test',
        },
      ];

      testCases.forEach(testCase => {
        const logEvent = {
          timestamp: Date.now(),
          logStreamName: 'test-stream',
          message: testCase.message,
        };

        const denial = parseMethod(logEvent, '/aws/lambda/test-function');
        
        if (denial) {
          expect(denial.resource).toBe(testCase.expectedResource);
        }
      });
    });
  });

  describe('findAssociatedResource', () => {
    it('should find resource by exact log group match', () => {
      const service = new CloudWatchLogsService('us-east-1');
      const findMethod = (service as any).findAssociatedResource.bind(service);

      const resources: CloudFormationResource[] = [
        {
          logicalId: 'TestFunction',
          physicalId: 'test-function',
          resourceType: 'AWS::Lambda::Function',
          logGroups: ['/aws/lambda/test-function'],
        },
      ];

      const result = findMethod('/aws/lambda/test-function', resources);

      expect(result).toEqual(resources[0]);
    });

    it('should return null when no matching resource found', () => {
      const service = new CloudWatchLogsService('us-east-1');
      const findMethod = (service as any).findAssociatedResource.bind(service);

      const resources: CloudFormationResource[] = [
        {
          logicalId: 'TestFunction',
          physicalId: 'test-function',
          resourceType: 'AWS::Lambda::Function',
          logGroups: ['/aws/lambda/test-function'],
        },
      ];

      const result = findMethod('/aws/lambda/other-function', resources);

      expect(result).toBeNull();
    });

    it('should find resource when log group is in array', () => {
      const service = new CloudWatchLogsService('us-east-1');
      const findMethod = (service as any).findAssociatedResource.bind(service);

      const resources: CloudFormationResource[] = [
        {
          logicalId: 'TestFunction',
          physicalId: 'test-function',
          resourceType: 'AWS::Lambda::Function',
          logGroups: ['/aws/lambda/test-function-1', '/aws/lambda/test-function-2'],
        },
      ];

      const result = findMethod('/aws/lambda/test-function-2', resources);

      expect(result).toEqual(resources[0]);
    });
  });
}); 