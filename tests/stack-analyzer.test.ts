import { StackAnalyzerService } from '../src/services/stack-analyzer.js';
import { CloudFormationService } from '../src/services/cloudformation.js';
import { CloudWatchLogsService } from '../src/services/cloudwatch-logs.js';
import { PermissionAnalyzerService } from '../src/services/permission-analyzer.js';
import { AnalysisConfig, StackAnalysisResult } from '../src/types/index.js';

// Mock the service dependencies
jest.mock('../src/services/cloudformation.js');
jest.mock('../src/services/cloudwatch-logs.js');
jest.mock('../src/services/permission-analyzer.js');

describe('StackAnalyzerService', () => {
  let analyzer: StackAnalyzerService;
  let mockCfService: jest.Mocked<CloudFormationService>;
  let mockLogsService: jest.Mocked<CloudWatchLogsService>;
  let mockPermissionAnalyzer: jest.Mocked<PermissionAnalyzerService>;

  beforeEach(() => {
    mockCfService = {
      getStackInfo: jest.fn(),
      getStackResources: jest.fn(),
    } as any;

    mockLogsService = {
      analyzeLogGroups: jest.fn(),
    } as any;

    mockPermissionAnalyzer = {
      analyzeLogs: jest.fn(),
      generateIAMPolicy: jest.fn(),
      generateCDKCode: jest.fn(),
    } as any;

         // Mock the constructors
     (CloudFormationService as jest.Mock).mockImplementation(() => mockCfService);
     (CloudWatchLogsService as jest.Mock).mockImplementation(() => mockLogsService);
     (PermissionAnalyzerService as unknown as jest.Mock).mockImplementation(() => mockPermissionAnalyzer);

    analyzer = new StackAnalyzerService('us-east-1');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeStack', () => {
    it('should perform complete stack analysis workflow', async () => {
      const config: AnalysisConfig = {
        stackName: 'test-stack',
        region: 'us-east-1',
        lookbackDays: 7,
        maxLogEvents: 1000,
        includePatterns: [],
        excludePatterns: [],
      };

             const mockStackInfo = {
         stackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/12345',
         status: 'CREATE_COMPLETE',
       };

      const mockResources = [
        {
          logicalId: 'TestFunction',
          physicalId: 'test-function',
          resourceType: 'AWS::Lambda::Function',
          logGroups: ['/aws/lambda/test-function'],
        },
      ];

      const mockLogAnalysisResults = [
        {
          logGroupName: '/aws/lambda/test-function',
          associatedResource: mockResources[0] || null,
          permissionDenials: [
            {
              timestamp: '2024-01-01T00:00:00Z',
              logGroup: '/aws/lambda/test-function',
              logStream: 'test-stream',
              message: 'AccessDenied',
              action: 's3:GetObject',
              resource: 'arn:aws:s3:::test-bucket/*',
              principal: 'arn:aws:iam::123456789012:role/test-role',
              errorCode: 'AccessDenied',
            },
          ],
          totalEvents: 1,
          timeRange: {
            start: new Date('2024-01-01'),
            end: new Date('2024-01-02'),
          },
        },
      ];

             const mockSuggestedPermissions = [
         {
           action: 's3:GetObject',
           resource: 'arn:aws:s3:::test-bucket/*',
           effect: 'Allow' as const,
           reasoning: 'Permission denied in /aws/lambda/test-function: AccessDenied',
           frequency: 1,
           severity: 'Critical' as const,
         },
       ];

      mockCfService.getStackInfo.mockResolvedValue(mockStackInfo);
      mockCfService.getStackResources.mockResolvedValue(mockResources);
      mockLogsService.analyzeLogGroups.mockResolvedValue(mockLogAnalysisResults);
      mockPermissionAnalyzer.analyzeLogs.mockReturnValue(mockSuggestedPermissions);

      const result = await analyzer.analyzeStack(config);

      expect(mockCfService.getStackInfo).toHaveBeenCalledWith('test-stack');
      expect(mockCfService.getStackResources).toHaveBeenCalledWith('test-stack');
      expect(mockLogsService.analyzeLogGroups).toHaveBeenCalledWith(
        ['/aws/lambda/test-function'],
        mockResources,
        7,
        1000
      );
      expect(mockPermissionAnalyzer.analyzeLogs).toHaveBeenCalledWith(mockLogAnalysisResults);

      expect(result).toMatchObject({
        stackName: 'test-stack',
        stackId: mockStackInfo.stackId,
        region: 'us-east-1',
        resources: mockResources,
        logAnalysisResults: mockLogAnalysisResults,
        suggestedPermissions: mockSuggestedPermissions,
      });
      expect(result.analysisTimestamp).toBeInstanceOf(Date);
    });

         it('should apply include patterns correctly', async () => {
       const config: AnalysisConfig = {
         stackName: 'test-stack',
         region: 'us-east-1',
         lookbackDays: 7,
         maxLogEvents: 1000,
         includePatterns: ['/aws/lambda/.*'],
         excludePatterns: [],
       };

       const mockResources = [
         {
           logicalId: 'TestFunction',
           physicalId: 'test-function',
           resourceType: 'AWS::Lambda::Function',
           logGroups: ['/aws/lambda/test-function'],
         },
         {
           logicalId: 'TestApi',
           physicalId: 'test-api',
           resourceType: 'AWS::ApiGateway::RestApi',
           logGroups: ['/aws/apigateway/test-api'],
         },
       ];

       mockCfService.getStackInfo.mockResolvedValue({
         stackId: 'test-stack-id',
         status: 'CREATE_COMPLETE',
       });
      mockCfService.getStackResources.mockResolvedValue(mockResources);
      mockLogsService.analyzeLogGroups.mockResolvedValue([]);
      mockPermissionAnalyzer.analyzeLogs.mockReturnValue([]);

      await analyzer.analyzeStack(config);

      // Should only analyze Lambda log groups (matching the include pattern)
      expect(mockLogsService.analyzeLogGroups).toHaveBeenCalledWith(
        ['/aws/lambda/test-function'],
        mockResources,
        7,
        1000
      );
    });

         it('should apply exclude patterns correctly', async () => {
       const config: AnalysisConfig = {
         stackName: 'test-stack',
         region: 'us-east-1',
         lookbackDays: 7,
         maxLogEvents: 1000,
         includePatterns: [],
         excludePatterns: ['/aws/apigateway/.*'],
       };

       const mockResources = [
         {
           logicalId: 'TestFunction',
           physicalId: 'test-function',
           resourceType: 'AWS::Lambda::Function',
           logGroups: ['/aws/lambda/test-function'],
         },
         {
           logicalId: 'TestApi',
           physicalId: 'test-api',
           resourceType: 'AWS::ApiGateway::RestApi',
           logGroups: ['/aws/apigateway/test-api'],
         },
       ];

       mockCfService.getStackInfo.mockResolvedValue({
         stackId: 'test-stack-id',
         status: 'CREATE_COMPLETE',
       });
      mockCfService.getStackResources.mockResolvedValue(mockResources);
      mockLogsService.analyzeLogGroups.mockResolvedValue([]);
      mockPermissionAnalyzer.analyzeLogs.mockReturnValue([]);

      await analyzer.analyzeStack(config);

      // Should exclude API Gateway log groups
      expect(mockLogsService.analyzeLogGroups).toHaveBeenCalledWith(
        ['/aws/lambda/test-function'],
        mockResources,
        7,
        1000
      );
    });

    it('should handle resources with no log groups', async () => {
      const config: AnalysisConfig = {
        stackName: 'test-stack',
        region: 'us-east-1',
        lookbackDays: 7,
        maxLogEvents: 1000,
        includePatterns: [],
        excludePatterns: [],
      };

      const mockResources = [
        {
          logicalId: 'TestBucket',
          physicalId: 'test-bucket',
          resourceType: 'AWS::S3::Bucket',
          logGroups: [],
        },
      ];

             mockCfService.getStackInfo.mockResolvedValue({
         stackId: 'test-stack-id',
         status: 'CREATE_COMPLETE',
       });
       mockCfService.getStackResources.mockResolvedValue(mockResources);
       mockLogsService.analyzeLogGroups.mockResolvedValue([]);
       mockPermissionAnalyzer.analyzeLogs.mockReturnValue([]);

       await analyzer.analyzeStack(config);

       // Should analyze empty log groups array
       expect(mockLogsService.analyzeLogGroups).toHaveBeenCalledWith(
         [],
         mockResources,
         7,
         1000
       );
    });
  });

  describe('generateReport', () => {
    it('should generate a comprehensive markdown report', async () => {
      const mockResult: StackAnalysisResult = {
        stackName: 'test-stack',
        stackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/test-stack/12345',
        region: 'us-east-1',
        resources: [
          {
            logicalId: 'TestFunction',
            physicalId: 'test-function',
            resourceType: 'AWS::Lambda::Function',
            logGroups: ['/aws/lambda/test-function'],
          },
        ],
        logAnalysisResults: [
          {
            logGroupName: '/aws/lambda/test-function',
            associatedResource: {
              logicalId: 'TestFunction',
              physicalId: 'test-function',
              resourceType: 'AWS::Lambda::Function',
              logGroups: ['/aws/lambda/test-function'],
            },
            permissionDenials: [
              {
                timestamp: '2024-01-01T00:00:00Z',
                logGroup: '/aws/lambda/test-function',
                logStream: 'test-stream',
                message: 'AccessDenied',
                action: 's3:GetObject',
                resource: 'arn:aws:s3:::test-bucket/*',
                principal: 'arn:aws:iam::123456789012:role/test-role',
                errorCode: 'AccessDenied',
              },
            ],
            totalEvents: 1,
            timeRange: {
              start: new Date('2024-01-01'),
              end: new Date('2024-01-02'),
            },
          },
        ],
        suggestedPermissions: [
          {
            action: 's3:GetObject',
            resource: 'arn:aws:s3:::test-bucket/*',
            effect: 'Allow',
            reasoning: 'Permission denied in /aws/lambda/test-function: AccessDenied',
            frequency: 1,
            severity: 'Critical',
          },
        ],
        analysisTimestamp: new Date('2024-01-01T12:00:00Z'),
      };

      const mockPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject'],
            Resource: ['arn:aws:s3:::test-bucket/*'],
          },
        ],
      };

      mockPermissionAnalyzer.generateIAMPolicy.mockReturnValue(mockPolicy);

      const report = await analyzer.generateReport(mockResult);

      expect(report).toContain('# IAM Scoped Permissions Analysis Report');
      expect(report).toContain('**Stack Name:** test-stack');
      expect(report).toContain('**Total Resources:** 1');
      expect(report).toContain('**Permission Denials Found:** 1');
      expect(report).toContain('**Critical Issues:** 1');
      expect(report).toContain('## Critical & High Priority Permissions');
      expect(report).toContain('### s3:GetObject (Critical)');
      expect(report).toContain('## Suggested IAM Policy');
      expect(report).toContain(JSON.stringify(mockPolicy, null, 2));
      expect(report).toContain('## Log Group Analysis Details');
      expect(report).toContain('## Resource Inventory');
    });

    it('should handle reports with no permission denials', async () => {
      const mockResult: StackAnalysisResult = {
        stackName: 'test-stack',
        stackId: 'test-stack-id',
        region: 'us-east-1',
        resources: [
          {
            logicalId: 'TestFunction',
            physicalId: 'test-function',
            resourceType: 'AWS::Lambda::Function',
            logGroups: ['/aws/lambda/test-function'],
          },
        ],
        logAnalysisResults: [
          {
            logGroupName: '/aws/lambda/test-function',
            associatedResource: null,
            permissionDenials: [],
            totalEvents: 0,
            timeRange: {
              start: new Date('2024-01-01'),
              end: new Date('2024-01-02'),
            },
          },
        ],
        suggestedPermissions: [],
        analysisTimestamp: new Date('2024-01-01T12:00:00Z'),
      };

      mockPermissionAnalyzer.generateIAMPolicy.mockReturnValue({
        Version: '2012-10-17',
        Statement: [],
      });

      const report = await analyzer.generateReport(mockResult);

      expect(report).toContain('**Permission Denials Found:** 0');
      expect(report).toContain('**Critical Issues:** 0');
      expect(report).not.toContain('## Critical & High Priority Permissions');
    });

    it('should include resource inventory even when no log groups exist', async () => {
      const mockResult: StackAnalysisResult = {
        stackName: 'test-stack',
        stackId: 'test-stack-id',
        region: 'us-east-1',
        resources: [
          {
            logicalId: 'TestBucket',
            physicalId: 'test-bucket',
            resourceType: 'AWS::S3::Bucket',
            logGroups: [],
          },
        ],
        logAnalysisResults: [],
        suggestedPermissions: [],
        analysisTimestamp: new Date('2024-01-01T12:00:00Z'),
      };

      mockPermissionAnalyzer.generateIAMPolicy.mockReturnValue({
        Version: '2012-10-17',
        Statement: [],
      });

      const report = await analyzer.generateReport(mockResult);

      expect(report).toContain('## Resource Inventory');
      expect(report).toContain('### TestBucket (AWS::S3::Bucket)');
      expect(report).toContain('**Associated Log Groups:** None detected');
    });
  });

  describe('generateIAMPolicy', () => {
    it('should delegate to PermissionAnalyzerService', () => {
      const mockResult: StackAnalysisResult = {
        stackName: 'test-stack',
        stackId: 'test-stack-id',
        region: 'us-east-1',
        resources: [],
        logAnalysisResults: [],
        suggestedPermissions: [
          {
            action: 's3:GetObject',
            resource: 'arn:aws:s3:::test-bucket/*',
            effect: 'Allow',
            reasoning: 'Test',
            frequency: 1,
            severity: 'High',
          },
        ],
        analysisTimestamp: new Date(),
      };

      const mockPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject'],
            Resource: ['arn:aws:s3:::test-bucket/*'],
          },
        ],
      };

      mockPermissionAnalyzer.generateIAMPolicy.mockReturnValue(mockPolicy);

      const result = analyzer.generateIAMPolicy(mockResult);

      expect(mockPermissionAnalyzer.generateIAMPolicy).toHaveBeenCalledWith(
        mockResult.suggestedPermissions
      );
      expect(result).toEqual(mockPolicy);
    });
  });

  describe('generateCDKCode', () => {
    it('should delegate to PermissionAnalyzerService with stack name', () => {
      const mockResult: StackAnalysisResult = {
        stackName: 'test-stack',
        stackId: 'test-stack-id',
        region: 'us-east-1',
        resources: [],
        logAnalysisResults: [],
        suggestedPermissions: [
          {
            action: 's3:GetObject',
            resource: 'arn:aws:s3:::test-bucket/*',
            effect: 'Allow',
            reasoning: 'Test',
            frequency: 1,
            severity: 'High',
          },
        ],
        analysisTimestamp: new Date(),
      };

      const mockCDKCode = `
        import * as iam from 'aws-cdk-lib/aws-iam';
        const role = new iam.Role(this, 'TestRole', {
          assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        });
      `;

      mockPermissionAnalyzer.generateCDKCode.mockReturnValue(mockCDKCode);

      const result = analyzer.generateCDKCode(mockResult);

      expect(mockPermissionAnalyzer.generateCDKCode).toHaveBeenCalledWith(
        mockResult.suggestedPermissions,
        'test-stack'
      );
      expect(result).toEqual(mockCDKCode);
    });
  });
}); 