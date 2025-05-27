#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { StackAnalyzerService } from './services/stack-analyzer.js';
import { AnalysisConfig } from './types/index.js';
import { writeFileSync } from 'fs';
import { join } from 'path';

const program = new Command();

program
  .name('iam-scoped-permissions')
  .description('Analyze AWS CloudFormation stacks for missing IAM permissions by examining CloudWatch logs')
  .version('1.0.0');

program
  .command('analyze')
  .description('Analyze a CloudFormation stack for permission issues')
  .requiredOption('-s, --stack <n>', 'CloudFormation stack name')
  .requiredOption('-r, --region <region>', 'AWS region')
  .option('-d, --days <number>', 'Number of days to look back in logs', '7')
  .option('-h, --hours <number>', 'Number of hours to look back in logs (overrides days)')
  .option('-m, --max-events <number>', 'Maximum number of log events to analyze per log group', '1000')
  .option('-i, --include <patterns...>', 'Include log groups matching these regex patterns', [])
  .option('-e, --exclude <patterns...>', 'Exclude log groups matching these regex patterns', [])
  .option('-o, --output <file>', 'Output file for the report (default: console)')
  .option('--policy-only', 'Output only the IAM policy JSON')
  .option('--cdk', 'Output CDK TypeScript code for roles and policies')
  .option('--json', 'Output results as JSON')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔍 IAM Scoped Permissions Analyzer'));
      console.log(chalk.gray('======================================'));
      console.log();

      // Calculate lookback time
      let lookbackDays: number;
      if (options.hours) {
        lookbackDays = parseFloat(options.hours) / 24;
        console.log(chalk.yellow(`Lookback period: ${options.hours} hours`));
      } else {
        lookbackDays = parseInt(options.days);
        console.log(chalk.yellow(`Lookback period: ${lookbackDays} days`));
      }

      const config: AnalysisConfig = {
        stackName: options.stack,
        region: options.region,
        lookbackDays: lookbackDays,
        maxLogEvents: parseInt(options.maxEvents),
        includePatterns: options.include || [],
        excludePatterns: options.exclude || [],
      };

      // Validate configuration
      if (config.lookbackDays <= 0) {
        console.error(chalk.red('Error: Time period must be a positive number'));
        process.exit(1);
      }

      if (config.maxLogEvents <= 0) {
        console.error(chalk.red('Error: Max events must be a positive number'));
        process.exit(1);
      }

      console.log(chalk.yellow(`Analyzing stack: ${config.stackName}`));
      console.log(chalk.yellow(`Region: ${config.region}`));
      
      if (config.includePatterns.length > 0) {
        console.log(chalk.yellow(`Include patterns: ${config.includePatterns.join(', ')}`));
      }
      
      if (config.excludePatterns.length > 0) {
        console.log(chalk.yellow(`Exclude patterns: ${config.excludePatterns.join(', ')}`));
      }
      
      console.log();

      // Create analyzer and run analysis
      const analyzer = new StackAnalyzerService(config.region);
      const result = await analyzer.analyzeStack(config);

      // Generate output
      let output: string;
      
      if (options.policyOnly) {
        const policy = analyzer.generateIAMPolicy(result);
        output = JSON.stringify(policy, null, 2);
      } else if (options.cdk) {
        output = analyzer.generateCDKCode(result);
      } else if (options.json) {
        output = JSON.stringify(result, null, 2);
      } else {
        output = await analyzer.generateReport(result);
      }

      // Output to file or console
      if (options.output) {
        const outputPath = join(process.cwd(), options.output);
        writeFileSync(outputPath, output, 'utf8');
        console.log(chalk.green(`✅ Report saved to: ${outputPath}`));
      } else {
        console.log(output);
      }

      // Summary
      console.log();
      console.log(chalk.green('✅ Analysis completed successfully!'));
      
      const totalDenials = result.logAnalysisResults.reduce(
        (sum, r) => sum + r.permissionDenials.length, 0
      );
      const criticalIssues = result.suggestedPermissions.filter(p => p.severity === 'Critical').length;
      
      if (totalDenials > 0) {
        console.log(chalk.yellow(`⚠️  Found ${totalDenials} permission denials`));
        
        if (criticalIssues > 0) {
          console.log(chalk.red(`🚨 ${criticalIssues} critical issues require immediate attention`));
        }
      } else {
        console.log(chalk.green('🎉 No permission denials found in the analyzed logs'));
      }

    } catch (error) {
      console.error(chalk.red('❌ Analysis failed:'));
      
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
        
        // Provide helpful suggestions for common errors
        if (error.message.includes('does not exist')) {
          console.log();
          console.log(chalk.yellow('💡 Suggestions:'));
          console.log(chalk.yellow('  - Check that the stack name is correct'));
          console.log(chalk.yellow('  - Verify you are using the correct AWS region'));
          console.log(chalk.yellow('  - Ensure your AWS credentials have CloudFormation read permissions'));
        } else if (error.message.includes('AccessDenied') || error.message.includes('UnauthorizedOperation')) {
          console.log();
          console.log(chalk.yellow('💡 Suggestions:'));
          console.log(chalk.yellow('  - Check your AWS credentials and permissions'));
          console.log(chalk.yellow('  - Ensure you have access to CloudFormation and CloudWatch Logs'));
          console.log(chalk.yellow('  - Try running: aws sts get-caller-identity'));
        }
      } else {
        console.error(chalk.red('Unknown error occurred'));
      }
      
      process.exit(1);
    }
  });

program
  .command('list-stacks')
  .description('List CloudFormation stacks in the specified region')
  .requiredOption('-r, --region <region>', 'AWS region')
  .action(async (options) => {
    try {
      console.log(chalk.blue(`📋 CloudFormation stacks in ${options.region}:`));
      console.log();

      // Note: This would require adding a listStacks method to StackAnalyzerService
      // For now, we'll show a message about using AWS CLI
      console.log(chalk.yellow('To list stacks, use the AWS CLI:'));
      console.log(chalk.gray(`aws cloudformation list-stacks --region ${options.region} --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE`));
      
    } catch (error) {
      console.error(chalk.red('❌ Failed to list stacks:'));
      console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      process.exit(1);
    }
  });

// Add help examples
program.on('--help', () => {
  console.log();
  console.log('Examples:');
  console.log();
  console.log('  # Analyze a stack with default settings');
  console.log('  $ iam-scoped-permissions analyze -s my-stack -r us-east-1');
  console.log();
  console.log('  # Analyze with custom lookback period and save report');
  console.log('  $ iam-scoped-permissions analyze -s my-stack -r us-east-1 -d 14 -o report.md');
  console.log();
  console.log('  # Generate only the IAM policy JSON');
  console.log('  $ iam-scoped-permissions analyze -s my-stack -r us-east-1 --policy-only -o policy.json');
  console.log();
  console.log('  # Generate CDK TypeScript code for roles and policies');
  console.log('  $ iam-scoped-permissions analyze -s my-stack -r us-east-1 --cdk -o cdk-roles.ts');
  console.log();
  console.log('  # Include only Lambda function logs');
  console.log('  $ iam-scoped-permissions analyze -s my-stack -r us-east-1 -i "/aws/lambda/.*"');
  console.log();
  console.log('  # Exclude CloudTrail logs');
  console.log('  $ iam-scoped-permissions analyze -s my-stack -r us-east-1 -e ".*cloudtrail.*"');
  console.log();
});

// Parse command line arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
} 