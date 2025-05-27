export interface CloudFormationResource {
  logicalId: string;
  physicalId: string;
  resourceType: string;
  logGroups: string[];
  associatedRoles?: string[];
  associatedPolicies?: string[];
}

export interface PermissionDenial {
  timestamp: string;
  logGroup: string;
  logStream: string;
  message: string;
  action: string;
  resource: string;
  principal: string;
  errorCode: string;
  sourceIp?: string;
  userAgent?: string;
}

export interface LogAnalysisResult {
  logGroupName: string;
  associatedResource: CloudFormationResource | null;
  permissionDenials: PermissionDenial[];
  totalEvents: number;
  timeRange: {
    start: Date;
    end: Date;
  };
}

export interface StackAnalysisResult {
  stackName: string;
  stackId: string;
  region: string;
  resources: CloudFormationResource[];
  logAnalysisResults: LogAnalysisResult[];
  suggestedPermissions: SuggestedPermission[];
  analysisTimestamp: Date;
}

export interface SuggestedPermission {
  action: string;
  resource: string;
  effect: 'Allow';
  condition?: Record<string, unknown>;
  reasoning: string;
  frequency: number;
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
}

export interface AnalysisConfig {
  stackName: string;
  region: string;
  lookbackDays: number;
  maxLogEvents: number;
  includePatterns: string[];
  excludePatterns: string[];
}

export interface AWSCredentials {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region: string;
  profile?: string;
}
