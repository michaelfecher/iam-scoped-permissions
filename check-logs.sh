#!/bin/bash

export AWS_PROFILE=mfe-dev.AdministratorAccess

echo "Checking Step Function log group..."
aws logs describe-log-groups --log-group-name-prefix "cdk-test-dev-StepFunctionLogGroup" --region eu-west-1

echo ""
echo "Checking log streams in Step Function log group..."
aws logs describe-log-streams --log-group-name "cdk-test-dev-StepFunctionLogGroup5D8A5468-CyZ5WukCMeuE" --region eu-west-1 --order-by LastEventTime --descending --max-items 3

echo ""
echo "Getting recent log events..."
aws logs get-log-events --log-group-name "cdk-test-dev-StepFunctionLogGroup5D8A5468-CyZ5WukCMeuE" --region eu-west-1 --start-time $(date -d '1 hour ago' +%s)000 --limit 10 