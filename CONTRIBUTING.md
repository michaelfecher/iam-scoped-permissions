# Contributing to IAM Scoped Permissions Analyzer

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## 🚀 Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/iam-scoped-permissions.git
   cd iam-scoped-permissions
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Build the project**:
   ```bash
   npm run build
   ```

## 🛠️ Development Workflow

### Setting up your development environment

1. **Install Node.js 18+** (recommended: use nvm)
2. **Configure AWS credentials** for testing
3. **Install dependencies**: `npm install`
4. **Run in development mode**: `npm run dev`

### Code Style

This project uses:
- **ESLint** for linting
- **Prettier** for code formatting
- **TypeScript** for type safety

Run these commands before submitting:
```bash
npm run lint        # Check for linting issues
npm run lint:fix    # Fix linting issues automatically
npm run format      # Format code with Prettier
npm run type-check  # Check TypeScript types
```

## 📝 Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-rds-support` - New features
- `fix/log-group-parsing` - Bug fixes
- `docs/update-readme` - Documentation updates
- `refactor/service-classes` - Code refactoring

### Commit Messages

Follow conventional commit format:
```
feat: add support for EKS log group analysis
fix: handle malformed CloudWatch log events
docs: update installation instructions
refactor: extract permission pattern matching logic
```

### Code Organization

```
src/
├── types/           # TypeScript interfaces and types
├── services/        # Core business logic
│   ├── cloudformation.ts      # CloudFormation resource discovery
│   ├── cloudwatch-logs.ts     # Log analysis
│   ├── permission-analyzer.ts # Permission recommendation logic
│   └── stack-analyzer.ts      # Main orchestration
└── index.ts         # CLI entry point
```

## 🧪 Testing

### Running Tests

```bash
npm test           # Run all tests
npm run test:watch # Run tests in watch mode
npm run test:coverage # Generate coverage report
```

### Writing Tests

- Place tests in `tests/` directory
- Use descriptive test names
- Mock AWS API calls
- Test both success and error scenarios

Example test structure:
```typescript
describe('CloudFormationService', () => {
  describe('getStackResources', () => {
    it('should return resources for valid stack', async () => {
      // Test implementation
    });

    it('should handle stack not found error', async () => {
      // Test implementation
    });
  });
});
```

## 🔧 Adding New Features

### Adding Support for New AWS Services

1. **Update `getLogGroupsForResource`** in `cloudformation.ts`:
   ```typescript
   case 'AWS::NewService::Resource':
     logGroups.push(`/aws/newservice/${physicalId}`);
     break;
   ```

2. **Add service-specific patterns** in `cloudwatch-logs.ts`:
   ```typescript
   // Add new error patterns specific to the service
   /NewService\.SpecificError/i,
   ```

3. **Update permission mapping** in `permission-analyzer.ts`:
   ```typescript
   newservice: 'newservice.amazonaws.com',
   ```

4. **Add tests** for the new service support

### Adding New Permission Patterns

1. **Add patterns** to `hasPermissionDenialPattern` in `cloudwatch-logs.ts`
2. **Test with real log samples** from the service
3. **Update extraction methods** if needed for service-specific data

## 📋 Pull Request Process

1. **Create a descriptive PR title**:
   - ✅ "feat: add EKS cluster log group support"
   - ❌ "update code"

2. **Include in PR description**:
   - What changes were made
   - Why they were needed
   - How to test the changes
   - Any breaking changes

3. **Ensure all checks pass**:
   - All tests pass
   - Linting passes
   - TypeScript compilation succeeds
   - Code is formatted

4. **Link related issues** using keywords:
   ```
   Closes #123
   Fixes #456
   Related to #789
   ```

## 🐛 Reporting Bugs

Use the GitHub issue template and include:

1. **Environment details**:
   - Node.js version
   - AWS region
   - Operating system

2. **Steps to reproduce**:
   - Exact commands run
   - Stack configuration
   - Expected vs actual behavior

3. **Logs and output**:
   - Error messages
   - Debug output (if available)
   - Screenshots (if relevant)

## 💡 Feature Requests

Before requesting a feature:

1. **Check existing issues** for similar requests
2. **Describe the use case** clearly
3. **Explain why it's valuable** to other users
4. **Consider implementation complexity**

## 📖 Documentation

Help improve documentation:

- **README updates** for new features
- **Code comments** for complex logic
- **JSDoc comments** for public APIs
- **Example usage** for new functionality

## 🤝 Code of Conduct

- Be respectful and inclusive
- Help others learn and contribute
- Focus on constructive feedback
- Celebrate successes and learn from failures

## 🎯 Areas for Contribution

We'd love help with:

- **New AWS service support** (EKS, Fargate, etc.)
- **Enhanced error pattern detection**
- **Performance optimizations**
- **Better CLI output formatting**
- **Integration examples** (CI/CD, Lambda functions)
- **Documentation improvements**
- **Test coverage expansion**

## 🏆 Recognition

Contributors will be:
- Listed in the README
- Mentioned in release notes
- Credited in commit messages

Thank you for contributing to better AWS security through least-privilege IAM policies! 🎉 