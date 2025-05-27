import { PermissionAnalyzerService } from '../src/services/permission-analyzer.js';
import { SuggestedPermission, LogAnalysisResult } from '../src/types/index.js';

describe('PermissionAnalyzerService', () => {
  let analyzer: PermissionAnalyzerService;

  beforeEach(() => {
    analyzer = new PermissionAnalyzerService();
  });

  describe('analyzeLogs', () => {
    it('should analyze logs and generate suggested permissions with correct severity', () => {
      const mockLogResults: LogAnalysisResult[] = [
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
              resource: 'arn:aws:s3:::test-bucket/file.txt',
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

      const result = analyzer.analyzeLogs(mockLogResults);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        action: 's3:getobject',
        resource: 'arn:aws:s3:::test-bucket/file.txt',
        effect: 'Allow',
        frequency: 1,
        severity: 'Critical',
      });
    });

    it('should aggregate multiple denials for the same action/resource', () => {
      const mockLogResults: LogAnalysisResult[] = [
        {
          logGroupName: '/aws/lambda/test-function',
          associatedResource: null,
          permissionDenials: [
            {
              timestamp: '2024-01-01T00:00:00Z',
              logGroup: '/aws/lambda/test-function',
              logStream: 'test-stream-1',
              message: 'AccessDenied',
              action: 's3:GetObject',
              resource: 'arn:aws:s3:::test-bucket/*',
              principal: 'arn:aws:iam::123456789012:role/test-role',
              errorCode: 'AccessDenied',
            },
            {
              timestamp: '2024-01-01T01:00:00Z',
              logGroup: '/aws/lambda/test-function',
              logStream: 'test-stream-2',
              message: 'AccessDenied',
              action: 's3:GetObject',
              resource: 'arn:aws:s3:::test-bucket/*',
              principal: 'arn:aws:iam::123456789012:role/test-role',
              errorCode: 'AccessDenied',
            },
          ],
          totalEvents: 2,
          timeRange: {
            start: new Date('2024-01-01'),
            end: new Date('2024-01-02'),
          },
        },
      ];

      const result = analyzer.analyzeLogs(mockLogResults);

      expect(result).toHaveLength(1);
      expect(result[0]?.frequency).toBe(2);
    });

    it('should calculate severity based on action type and frequency', () => {
      const mockLogResults: LogAnalysisResult[] = [
        {
          logGroupName: '/aws/lambda/test-function',
          associatedResource: null,
          permissionDenials: [
            {
              timestamp: '2024-01-01T00:00:00Z',
              logGroup: '/aws/lambda/test-function',
              logStream: 'test-stream',
              message: 'AccessDenied',
              action: 'lambda:InvokeFunction',
              resource: 'arn:aws:lambda:us-east-1:123456789012:function:test',
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

      const result = analyzer.analyzeLogs(mockLogResults);

      expect(result[0]?.severity).toBe('Critical');
    });

    it('should sort permissions by severity and frequency', () => {
      const mockLogResults: LogAnalysisResult[] = [
        {
          logGroupName: '/aws/lambda/test-function',
          associatedResource: null,
          permissionDenials: [
            {
              timestamp: '2024-01-01T00:00:00Z',
              logGroup: '/aws/lambda/test-function',
              logStream: 'test-stream',
              message: 'AccessDenied',
              action: 'logs:CreateLogGroup',
              resource: 'arn:aws:logs:us-east-1:123456789012:*',
              principal: 'arn:aws:iam::123456789012:role/test-role',
              errorCode: 'AccessDenied',
            },
            {
              timestamp: '2024-01-01T01:00:00Z',
              logGroup: '/aws/lambda/test-function',
              logStream: 'test-stream',
              message: 'AccessDenied',
              action: 's3:GetObject',
              resource: 'arn:aws:s3:::test-bucket/*',
              principal: 'arn:aws:iam::123456789012:role/test-role',
              errorCode: 'AccessDenied',
            },
          ],
          totalEvents: 2,
          timeRange: {
            start: new Date('2024-01-01'),
            end: new Date('2024-01-02'),
          },
        },
      ];

      const result = analyzer.analyzeLogs(mockLogResults);

      // S3 GetObject should be ranked higher (Critical) than logs (likely Medium)
      expect(result[0]?.action).toBe('s3:getobject');
      expect(result[0]?.severity).toBe('Critical');
    });
  });

  describe('generateIAMPolicy', () => {
    it('should generate a valid IAM policy from suggested permissions', () => {
      const permissions: SuggestedPermission[] = [
        {
          action: 's3:GetObject',
          resource: 'arn:aws:s3:::test-bucket/*',
          effect: 'Allow',
          reasoning: 'Test permission',
          frequency: 5,
          severity: 'High',
        },
        {
          action: 's3:PutObject',
          resource: 'arn:aws:s3:::test-bucket/*',
          effect: 'Allow',
          reasoning: 'Test permission',
          frequency: 3,
          severity: 'Medium',
        },
      ];

      const policy = analyzer.generateIAMPolicy(permissions);

      expect(policy.Version).toBe('2012-10-17');
      expect(policy.Statement).toHaveLength(1);
      expect(policy.Statement[0]).toMatchObject({
        Effect: 'Allow',
        Action: ['s3:GetObject', 's3:PutObject'],
        Resource: ['arn:aws:s3:::test-bucket/*'],
      });
    });

    it('should exclude low-frequency, low-severity permissions', () => {
      const permissions: SuggestedPermission[] = [
        {
          action: 's3:GetObject',
          resource: 'arn:aws:s3:::test-bucket/*',
          effect: 'Allow',
          reasoning: 'Test permission',
          frequency: 0,
          severity: 'Low',
        },
        {
          action: 's3:PutObject',
          resource: 'arn:aws:s3:::test-bucket/*',
          effect: 'Allow',
          reasoning: 'Test permission',
          frequency: 3,
          severity: 'High',
        },
      ];

      const policy = analyzer.generateIAMPolicy(permissions);

      expect(policy.Statement).toHaveLength(1);
      expect(policy.Statement[0]?.Action).toEqual(['s3:PutObject']);
    });

    it('should group permissions by resource and conditions', () => {
      const permissions: SuggestedPermission[] = [
        {
          action: 's3:GetObject',
          resource: 'arn:aws:s3:::bucket1/*',
          effect: 'Allow',
          reasoning: 'Test permission',
          frequency: 5,
          severity: 'High',
        },
        {
          action: 's3:PutObject',
          resource: 'arn:aws:s3:::bucket2/*',
          effect: 'Allow',
          reasoning: 'Test permission',
          frequency: 3,
          severity: 'Medium',
        },
      ];

      const policy = analyzer.generateIAMPolicy(permissions);

      expect(policy.Statement).toHaveLength(2);
    });

    it('should include conditions when present', () => {
      const permissions: SuggestedPermission[] = [
        {
          action: 's3:DeleteObject',
          resource: 'arn:aws:s3:::test-bucket/*',
          effect: 'Allow',
          condition: {
            Bool: { 'aws:MultiFactorAuthPresent': 'true' },
          },
          reasoning: 'Test permission',
          frequency: 2,
          severity: 'High',
        },
      ];

      const policy = analyzer.generateIAMPolicy(permissions);

      expect(policy.Statement[0]?.Condition).toEqual({
        Bool: { 'aws:MultiFactorAuthPresent': 'true' },
      });
    });
  });

  describe('generateCDKCode', () => {
    it('should generate valid CDK TypeScript code', () => {
      const permissions: SuggestedPermission[] = [
        {
          action: 's3:GetObject',
          resource: 'arn:aws:s3:::test-bucket/*',
          effect: 'Allow',
          reasoning: 'Permission denied in /aws/lambda/test-function: AccessDenied',
          frequency: 5,
          severity: 'High',
        },
        {
          action: 'dynamodb:GetItem',
          resource: 'arn:aws:dynamodb:us-east-1:123456789012:table/test-table',
          effect: 'Allow',
          reasoning: 'Permission denied in /aws/lambda/test-function: AccessDenied',
          frequency: 3,
          severity: 'Medium',
        },
      ];

      const cdkCode = analyzer.generateCDKCode(permissions, 'test-stack');

      expect(cdkCode).toContain("import * as iam from 'aws-cdk-lib/aws-iam';");
      expect(cdkCode).toContain('const teststackS3Role = new iam.Role');
      expect(cdkCode).toContain('const teststackDynamodbRole = new iam.Role');
      expect(cdkCode).toContain('addToPolicy(new iam.PolicyStatement');
      expect(cdkCode).toContain("actions: ['s3:GetObject']");
      expect(cdkCode).toContain("actions: ['dynamodb:GetItem']");
      expect(cdkCode).toContain('cdk-nag AWS Solutions IAM4');
    });

    it('should group permissions by service', () => {
      const permissions: SuggestedPermission[] = [
        {
          action: 's3:GetObject',
          resource: 'arn:aws:s3:::test-bucket/*',
          effect: 'Allow',
          reasoning: 'Test',
          frequency: 5,
          severity: 'High',
        },
        {
          action: 's3:PutObject',
          resource: 'arn:aws:s3:::test-bucket/*',
          effect: 'Allow',
          reasoning: 'Test',
          frequency: 3,
          severity: 'Medium',
        },
      ];

      const cdkCode = analyzer.generateCDKCode(permissions, 'test-stack');

      // Should create one role for s3 service with both actions
      expect(cdkCode).toContain('teststackS3Role');
      expect(cdkCode).toContain("'s3:GetObject',");
      expect(cdkCode).toContain("'s3:PutObject',");
    });

    it('should optimize resource ARNs to minimize wildcards', () => {
      const permissions: SuggestedPermission[] = [
        {
          action: 'logs:CreateLogGroup',
          resource: 'arn:aws:logs:us-east-1:123456789012:*',
          effect: 'Allow',
          reasoning: 'Test',
          frequency: 5,
          severity: 'High',
        },
      ];

      const cdkCode = analyzer.generateCDKCode(permissions, 'test-stack');

      // Should optimize the resource ARN
      expect(cdkCode).toContain('log-group:*');
    });

    it('should include proper service principals', () => {
      const permissions: SuggestedPermission[] = [
        {
          action: 'lambda:InvokeFunction',
          resource: 'arn:aws:lambda:us-east-1:123456789012:function:test',
          effect: 'Allow',
          reasoning: 'Test',
          frequency: 5,
          severity: 'High',
        },
      ];

      const cdkCode = analyzer.generateCDKCode(permissions, 'test-stack');

      expect(cdkCode).toContain("assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com')");
    });

    it('should handle empty permissions gracefully', () => {
      const permissions: SuggestedPermission[] = [];

      const cdkCode = analyzer.generateCDKCode(permissions, 'test-stack');

      expect(cdkCode).toContain('No permissions to generate - no issues found!');
    });

    it('should filter out low-priority permissions', () => {
      const permissions: SuggestedPermission[] = [
        {
          action: 's3:GetObject',
          resource: 'arn:aws:s3:::test-bucket/*',
          effect: 'Allow',
          reasoning: 'Test',
          frequency: 0,
          severity: 'Low',
        },
        {
          action: 's3:PutObject',
          resource: 'arn:aws:s3:::test-bucket/*',
          effect: 'Allow',
          reasoning: 'Test',
          frequency: 3,
          severity: 'High',
        },
      ];

      const cdkCode = analyzer.generateCDKCode(permissions, 'test-stack');

      expect(cdkCode).toContain("'s3:PutObject'");
      expect(cdkCode).not.toContain("'s3:GetObject'");
    });
  });

  describe('optimizeResourceArn', () => {
    it('should optimize CloudWatch Logs ARNs', () => {
      const analyzer = new PermissionAnalyzerService();
      // Access private method for testing
      const optimizeResourceArn = (analyzer as any).optimizeResourceArn.bind(analyzer);

      const optimized = optimizeResourceArn('arn:aws:logs:us-east-1:123456789012:*');
      expect(optimized).toBe('arn:aws:logs:us-east-1:123456789012:log-group:*');
    });

    it('should ensure S3 ARNs have object-level access', () => {
      const analyzer = new PermissionAnalyzerService();
      const optimizeResourceArn = (analyzer as any).optimizeResourceArn.bind(analyzer);

      const optimized = optimizeResourceArn('arn:aws:s3:::test-bucket');
      expect(optimized).toBe('arn:aws:s3:::test-bucket/*');
    });

    it('should leave already specific ARNs unchanged', () => {
      const analyzer = new PermissionAnalyzerService();
      const optimizeResourceArn = (analyzer as any).optimizeResourceArn.bind(analyzer);

      const specificArn = 'arn:aws:dynamodb:us-east-1:123456789012:table/test-table';
      const optimized = optimizeResourceArn(specificArn);
      expect(optimized).toBe(specificArn);
    });

    it('should handle unknown resources', () => {
      const analyzer = new PermissionAnalyzerService();
      const optimizeResourceArn = (analyzer as any).optimizeResourceArn.bind(analyzer);

      expect(optimizeResourceArn('Unknown')).toBe('*');
      expect(optimizeResourceArn('*')).toBe('*');
    });
  });
}); 