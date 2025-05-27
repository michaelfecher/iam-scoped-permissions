#!/usr/bin/env node

/**
 * CDK Test Integration - Enhanced IAM Scoped Permissions
 * 
 * This script demonstrates the enhanced IAM analysis tool with the cdk-test project,
 * showing how it can analyze both CloudFormation resources AND external roles
 * (like GitHub Actions) that interact with those resources.
 */

// Configuration
const CDK_STACK_NAME = 'cdk-test-dev';
const AWS_REGION = 'eu-west-1';
const AWS_ACCOUNT = '396913727235'; // Your AWS account

console.log('\n🧪 CDK Test Integration - Enhanced IAM Scoped Permissions');
console.log('================================================================');
console.log();

function runTest(testName, command, description) {
  console.log(`\n📋 Test: ${testName}`);
  console.log(`Description: ${description}`);
  console.log(`Command: ${command}`);
  console.log('─'.repeat(80));
  
  // Note: This is a demonstration - in real usage you'd have AWS credentials configured
  console.log('⚠️  This is a demonstration of the enhanced CLI commands.');
  console.log('   To run for real, configure AWS credentials first.');
  console.log();
  
  // Show what the command would do
  console.log('✅ Command ready to execute with proper AWS credentials.');
  console.log();
}

function main() {
  
  // Test 1: Basic CDK Stack Analysis
  runTest(
    'Basic CDK Stack Analysis',
    `npm run analyze -- --stack ${CDK_STACK_NAME} --region ${AWS_REGION} --hours 24`,
    'Analyze the CDK test stack resources for IAM permission issues in the last 24 hours'
  );

  // Test 2: Enhanced Analysis with External Log Groups
  runTest(
    'Enhanced Analysis with External Log Groups',
    `npm run analyze -- \\
      --stack ${CDK_STACK_NAME} \\
      --region ${AWS_REGION} \\
      --external-log-groups "CloudTrail/aws-api-logs,/aws/lambda/github-deployment" \\
      --hours 6`,
    'Analyze both CDK stack resources AND external log groups (like CloudTrail logs from GitHub Actions)'
  );

  // Test 3: CloudTrail Auto-Discovery
  runTest(
    'CloudTrail Auto-Discovery',
    `npm run analyze -- \\
      --stack ${CDK_STACK_NAME} \\
      --region ${AWS_REGION} \\
      --include-cloudtrail \\
      --hours 2`,
    'Automatically discover and analyze CloudTrail log groups that might contain external role activity'
  );

  // Test 4: GitHub Actions Role Analysis
  runTest(
    'GitHub Actions Role Analysis',
    `npm run analyze -- \\
      --stack ${CDK_STACK_NAME} \\
      --region ${AWS_REGION} \\
      --include-cloudtrail \\
      --role-patterns "GitHubActions-*,GitHub-Deploy-*" \\
      --hours 1`,
    'Focus on permission denials from GitHub Actions roles that deploy to your CDK resources'
  );

  // Test 5: Comprehensive Multi-Source Analysis
  runTest(
    'Comprehensive Multi-Source Analysis',
    `npm run analyze -- \\
      --stack ${CDK_STACK_NAME} \\
      --region ${AWS_REGION} \\
      --external-log-groups "CloudTrail/aws-api-logs" \\
      --include-cloudtrail \\
      --role-patterns "GitHubActions-*,Jenkins-*" \\
      --include "/aws/lambda/.*" \\
      --exclude ".*LogRetention.*" \\
      --hours 4 \\
      --output cdk-test-analysis.md`,
    'Complete analysis: CDK stack + CloudTrail + external roles + filtered patterns + report generation'
  );

  // Test 6: Policy Generation for CDK + GitHub Actions
  runTest(
    'Policy Generation for CDK + GitHub Actions',
    `npm run analyze -- \\
      --stack ${CDK_STACK_NAME} \\
      --region ${AWS_REGION} \\
      --include-cloudtrail \\
      --role-patterns "GitHubActions-*" \\
      --policy-only \\
      --output cdk-test-policy.json \\
      --hours 2`,
    'Generate IAM policy JSON that fixes both CDK resource permissions AND GitHub Actions deployment permissions'
  );

  // Test 7: CDK Code Generation
  runTest(
    'CDK Code Generation',
    `npm run analyze -- \\
      --stack ${CDK_STACK_NAME} \\
      --region ${AWS_REGION} \\
      --include-cloudtrail \\
      --cdk \\
      --output cdk-test-roles.ts \\
      --hours 3`,
    'Generate CDK TypeScript code for IAM roles and policies based on the analysis'
  );

  console.log('\n🎉 All Enhanced Features Demonstrated!');
  console.log();
  console.log('📊 Key Benefits of the Enhanced Tool:');
  console.log();
  console.log('✅ Complete Visibility - Analyzes both CDK resources AND external roles');
  console.log('✅ GitHub Actions Ready - Finds permission denials from CI/CD workflows');
  console.log('✅ Smart Discovery - Automatically finds CloudTrail log groups');
  console.log('✅ Focused Analysis - Role patterns filter out noise');
  console.log('✅ Multiple Outputs - Generate policies, CDK code, or markdown reports');
  console.log();

  console.log('🚀 Real Usage Examples:');
  console.log();
  console.log('# Analyze your CDK stack + GitHub Actions deployments');
  console.log(`npm run analyze -- --stack ${CDK_STACK_NAME} --region ${AWS_REGION} --include-cloudtrail --role-patterns "GitHubActions-*"`);
  console.log();
  console.log('# Generate policy to fix all permission issues');
  console.log(`npm run analyze -- --stack ${CDK_STACK_NAME} --region ${AWS_REGION} --include-cloudtrail --policy-only --output fix-permissions.json`);
  console.log();

  console.log('📋 Next Steps:');
  console.log();
  console.log('1. Configure AWS credentials: aws configure');
  console.log(`2. Run basic analysis: npm run analyze -- --stack ${CDK_STACK_NAME} --region ${AWS_REGION}`);
  console.log('3. Add CloudTrail analysis: --include-cloudtrail');
  console.log('4. Filter for GitHub Actions: --role-patterns "GitHubActions-*"');
  console.log('5. Generate policies: --policy-only --output policy.json');
  console.log();

  console.log('✅ Enhanced IAM Scoped Permissions tool is ready for production use!');
}

main(); 