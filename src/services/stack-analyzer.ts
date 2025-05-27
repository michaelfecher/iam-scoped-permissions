import { CloudFormationService } from './cloudformation.js';
import { CloudWatchLogsService } from './cloudwatch-logs.js';
import { PermissionAnalyzerService } from './permission-analyzer.js';
import { StackAnalysisResult, AnalysisConfig } from '../types/index.js';

export class StackAnalyzerService {
  private cfService: CloudFormationService;
  private logsService: CloudWatchLogsService;
  private permissionAnalyzer: PermissionAnalyzerService;

  constructor(region: string) {
    this.cfService = new CloudFormationService(region);
    this.logsService = new CloudWatchLogsService(region);
    this.permissionAnalyzer = new PermissionAnalyzerService();
  }

  async analyzeStack(config: AnalysisConfig): Promise<StackAnalysisResult> {
    console.log(`Starting analysis of CloudFormation stack: ${config.stackName}`);

    // 1. Get stack information and resources
    const stackInfo = await this.cfService.getStackInfo(config.stackName);
    const resources = await this.cfService.getStackResources(config.stackName);

    console.log(`Found ${resources.length} resources in stack`);

    // 2. Collect log groups using the improved approach
    const allLogGroups = new Set<string>();

    // 2a. Get log groups from CloudFormation stack (explicit + referenced)
    console.log('🔍 Getting log groups from CloudFormation stack...');
    const stackLogGroups = await this.cfService.getStackLogGroups(config.stackName);
    
    console.log(`   - ${stackLogGroups.explicit.length} explicit log group resources`);
    console.log(`   - ${stackLogGroups.referenced.length} referenced log groups from services`);
    
    // Add all discovered log groups
    for (const logGroup of stackLogGroups.all) {
      allLogGroups.add(logGroup);
    }

    // 2a2. Optionally discover additional stack-related log groups
    if (config.discoverStackRelated) {
      console.log('🔍 Discovering additional stack-related log groups...');
      try {
        const discovered = await this.logsService.discoverAllLogGroups(config.stackName);
        console.log(`   - Found ${discovered.stackRelated.length} additional stack-related log groups`);
        for (const logGroup of discovered.stackRelated) {
          if (!allLogGroups.has(logGroup)) { // Avoid duplicates
            allLogGroups.add(logGroup);
          }
        }
      } catch (error) {
        console.warn('⚠️  Failed to discover stack-related log groups:', error);
      }
    }

    // 2b. Add external log groups if specified
    if (config.externalLogGroups && config.externalLogGroups.length > 0) {
      console.log(`Adding ${config.externalLogGroups.length} external log groups to analysis`);
      for (const externalLogGroup of config.externalLogGroups) {
        allLogGroups.add(externalLogGroup);
      }
    }

    // 2c. Add CloudTrail log groups if requested
    if (config.includeCloudTrail) {
      console.log('🔍 Discovering CloudTrail log groups...');
      try {
        const cloudTrailLogGroups = await this.logsService.discoverCloudTrailLogGroups();
        console.log(`Found ${cloudTrailLogGroups.length} CloudTrail log groups`);
        for (const ctLogGroup of cloudTrailLogGroups) {
          allLogGroups.add(ctLogGroup);
        }
      } catch (error) {
        console.warn('⚠️  Failed to discover CloudTrail log groups:', error);
      }
    }

    // Apply include/exclude patterns if specified
    let filteredLogGroups = Array.from(allLogGroups);

    if (config.includePatterns.length > 0) {
      filteredLogGroups = filteredLogGroups.filter(logGroup =>
        config.includePatterns.some(pattern => new RegExp(pattern).test(logGroup))
      );
    }

    if (config.excludePatterns.length > 0) {
      filteredLogGroups = filteredLogGroups.filter(
        logGroup => !config.excludePatterns.some(pattern => new RegExp(pattern).test(logGroup))
      );
    }

    console.log(`Analyzing ${filteredLogGroups.length} log groups`);
    
    if (config.rolePatterns && config.rolePatterns.length > 0) {
      console.log(`🔍 Applying role pattern filters: ${config.rolePatterns.join(', ')}`);
    }

    // 3. Analyze logs for permission denials
    const logAnalysisResults = await this.logsService.analyzeLogGroups(
      filteredLogGroups,
      resources,
      config.lookbackDays,
      config.maxLogEvents,
      config.rolePatterns
    );

    console.log(
      `Found permission denials in ${logAnalysisResults.filter(r => r.permissionDenials.length > 0).length} log groups`
    );

    // 4. Generate permission suggestions
    const suggestedPermissions = this.permissionAnalyzer.analyzeLogs(logAnalysisResults);

    console.log(`Generated ${suggestedPermissions.length} permission suggestions`);

    return {
      stackName: config.stackName,
      stackId: stackInfo.stackId,
      region: config.region,
      resources,
      logAnalysisResults,
      suggestedPermissions,
      analysisTimestamp: new Date(),
    };
  }

  async generateReport(result: StackAnalysisResult): Promise<string> {
    const report = [];

    report.push('# IAM Scoped Permissions Analysis Report');
    report.push('');
    report.push(`**Stack Name:** ${result.stackName}`);
    report.push(`**Stack ID:** ${result.stackId}`);
    report.push(`**Region:** ${result.region}`);
    report.push(`**Analysis Date:** ${result.analysisTimestamp.toISOString()}`);
    report.push('');

    // Summary section
    report.push('## Summary');
    report.push('');
    const totalDenials = result.logAnalysisResults.reduce(
      (sum, r) => sum + r.permissionDenials.length,
      0
    );
    const criticalPermissions = result.suggestedPermissions.filter(
      p => p.severity === 'Critical'
    ).length;
    const highPermissions = result.suggestedPermissions.filter(p => p.severity === 'High').length;

    report.push(`- **Total Resources:** ${result.resources.length}`);
    report.push(`- **Log Groups Analyzed:** ${result.logAnalysisResults.length}`);
    report.push(`- **Permission Denials Found:** ${totalDenials}`);
    report.push(`- **Suggested Permissions:** ${result.suggestedPermissions.length}`);
    report.push(`- **Critical Issues:** ${criticalPermissions}`);
    report.push(`- **High Priority Issues:** ${highPermissions}`);
    report.push('');

    // Critical and High severity permissions
    const criticalAndHigh = result.suggestedPermissions.filter(
      p => p.severity === 'Critical' || p.severity === 'High'
    );

    if (criticalAndHigh.length > 0) {
      report.push('## Critical & High Priority Permissions');
      report.push('');
      report.push('These permissions should be addressed immediately:');
      report.push('');

      for (const permission of criticalAndHigh) {
        report.push(`### ${permission.action} (${permission.severity})`);
        report.push('');
        report.push(`**Resource:** \`${permission.resource}\``);
        report.push(`**Frequency:** ${permission.frequency} occurrences`);
        report.push(`**Reasoning:** ${permission.reasoning}`);

        if (permission.condition) {
          report.push(`**Conditions:** \`${JSON.stringify(permission.condition, null, 2)}\``);
        }

        report.push('');
      }
    }

    // Suggested IAM Policy
    report.push('## Suggested IAM Policy');
    report.push('');
    report.push(
      'Based on the analysis, here is a minimal IAM policy that should resolve the identified permission issues:'
    );
    report.push('');

    const policy = this.permissionAnalyzer.generateIAMPolicy(result.suggestedPermissions);
    report.push('```json');
    report.push(JSON.stringify(policy, null, 2));
    report.push('```');
    report.push('');

    // Log Group Details
    if (result.logAnalysisResults.some(r => r.permissionDenials.length > 0)) {
      report.push('## Log Group Analysis Details');
      report.push('');

      for (const logResult of result.logAnalysisResults) {
        if (logResult.permissionDenials.length > 0) {
          report.push(`### ${logResult.logGroupName}`);
          report.push('');

          if (logResult.associatedResource) {
            report.push(
              `**Associated Resource:** ${logResult.associatedResource.logicalId} (${logResult.associatedResource.resourceType})`
            );
          }

          report.push(`**Permission Denials:** ${logResult.permissionDenials.length}`);
          report.push(
            `**Time Range:** ${logResult.timeRange.start.toISOString()} to ${logResult.timeRange.end.toISOString()}`
          );
          report.push('');

          // Show top 5 denials
          const topDenials = logResult.permissionDenials.slice(0, 5);
          for (const denial of topDenials) {
            report.push(
              `- **${denial.timestamp}**: ${denial.action} on ${denial.resource} - ${denial.errorCode}`
            );
          }

          if (logResult.permissionDenials.length > 5) {
            report.push(`- ... and ${logResult.permissionDenials.length - 5} more`);
          }

          report.push('');
        }
      }
    }

    // Resource Inventory
    report.push('## Resource Inventory');
    report.push('');
    report.push('All CloudFormation resources and their associated log groups:');
    report.push('');

    for (const resource of result.resources) {
      report.push(`### ${resource.logicalId} (${resource.resourceType})`);
      report.push('');
      report.push(`**Physical ID:** ${resource.physicalId}`);

      if (resource.logGroups.length > 0) {
        report.push(`**Associated Log Groups:**`);
        for (const logGroup of resource.logGroups) {
          report.push(`- ${logGroup}`);
        }
      } else {
        report.push(`**Associated Log Groups:** None detected`);
      }

      report.push('');
    }

    return report.join('\n');
  }

  generateIAMPolicy(result: StackAnalysisResult): object {
    return this.permissionAnalyzer.generateIAMPolicy(result.suggestedPermissions);
  }

  generateCDKCode(result: StackAnalysisResult): string {
    return this.permissionAnalyzer.generateCDKCode(result.suggestedPermissions, result.stackName);
  }
}
