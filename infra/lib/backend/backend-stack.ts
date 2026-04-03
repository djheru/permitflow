import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2_integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';
import * as path from 'path';

interface BackendStackProps extends cdk.StackProps {
  readonly stage: string;
  readonly serviceName: string;
  readonly corsAllowedOrigins: string[];
}

export class BackendStack extends cdk.Stack {
  public readonly apiUrl: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    const isProd = props.stage === 'prod';
    const backendPath = path.join(__dirname, '..', '..', '..', 'backend');

    // DynamoDB Table
    const progressTable = new dynamodb.Table(this, 'PermitProgressTable', {
      tableName: `${props.serviceName}-${props.stage}-progress`,
      partitionKey: { name: 'application_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      ...(isProd ? {} : { deletionProtection: false }),
    });

    // Log groups
    const workflowLogGroup = new logs.LogGroup(this, 'WorkflowLogGroup', {
      logGroupName: `/aws/lambda/${props.serviceName}-${props.stage}-workflow`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/aws/lambda/${props.serviceName}-${props.stage}-api`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fraudLogGroup = new logs.LogGroup(this, 'InspectionLogGroup', {
      logGroupName: `/aws/lambda/${props.serviceName}-${props.stage}-site-inspection`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Permit Workflow Function (Durable)
    const workflowFunction = new NodejsFunction(this, 'PermitWorkflowFunction', {
      functionName: `${props.serviceName}-${props.stage}-workflow`,
      entry: path.join(backendPath, 'src', 'permit-workflow', 'handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(300),
      memorySize: 1024,
      logGroup: workflowLogGroup,
      durableConfig: {
        executionTimeout: cdk.Duration.hours(1),
        retentionPeriod: cdk.Duration.days(3),
      },
      environment: {
        PROGRESS_TABLE_NAME: progressTable.tableName,
        LOG_LEVEL: isProd ? 'INFO' : 'DEBUG',
        POWERTOOLS_SERVICE_NAME: 'permit-workflow',
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // Add durable execution policy
    workflowFunction.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'service-role/AWSLambdaBasicDurableExecutionRolePolicy'
      )
    );

    // Version and alias for durable invocation
    const workflowVersion = workflowFunction.currentVersion;
    const workflowAlias = new lambda.Alias(this, 'WorkflowAlias', {
      aliasName: 'live',
      version: workflowVersion,
    });

    // Site Inspection Function
    const fraudCheckFunction = new NodejsFunction(this, 'SiteInspectionFunction', {
      functionName: `${props.serviceName}-${props.stage}-site-inspection`,
      entry: path.join(backendPath, 'src', 'site-inspection', 'handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logGroup: fraudLogGroup,
      environment: {
        WORKFLOW_FUNCTION_NAME: workflowAlias.functionArn,
        LOG_LEVEL: isProd ? 'INFO' : 'DEBUG',
        POWERTOOLS_SERVICE_NAME: 'site-inspection',
      },
      bundling: { minify: true, sourceMap: true },
    });

    // Grant fraud check callback permissions
    fraudCheckFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'lambda:SendDurableExecutionCallbackSuccess',
          'lambda:SendDurableExecutionCallbackFailure',
        ],
        resources: [
          workflowFunction.functionArn,
          `${workflowFunction.functionArn}:*`,
        ],
      })
    );

    // Update workflow with fraud check function name
    workflowFunction.addEnvironment(
      'SITE_INSPECTION_FUNCTION_NAME',
      fraudCheckFunction.functionName
    );

    // Grant workflow permissions
    progressTable.grantReadWriteData(workflowFunction);
    fraudCheckFunction.grantInvoke(workflowFunction);

    // API Function
    const apiFunction = new NodejsFunction(this, 'PermitApiFunction', {
      functionName: `${props.serviceName}-${props.stage}-api`,
      entry: path.join(backendPath, 'src', 'api', 'handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      logGroup: apiLogGroup,
      environment: {
        PROGRESS_TABLE_NAME: progressTable.tableName,
        WORKFLOW_FUNCTION_NAME: workflowAlias.functionArn,
        LOG_LEVEL: isProd ? 'INFO' : 'DEBUG',
        POWERTOOLS_SERVICE_NAME: 'permit-api',
        POWERTOOLS_METRICS_NAMESPACE: 'PermitFlow',
      },
      bundling: { minify: true, sourceMap: true },
    });

    // Grant API permissions
    progressTable.grantReadWriteData(apiFunction);
    workflowAlias.grantInvoke(apiFunction);
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'lambda:SendDurableExecutionCallbackSuccess',
          'lambda:SendDurableExecutionCallbackFailure',
        ],
        resources: [
          workflowFunction.functionArn,
          `${workflowFunction.functionArn}:*`,
        ],
      })
    );

    // HTTP API
    const httpApi = new apigatewayv2.HttpApi(this, 'PermitApi', {
      apiName: `${props.serviceName}-${props.stage}`,
      corsPreflight: {
        allowOrigins: props.corsAllowedOrigins,
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const apiIntegration = new apigatewayv2_integrations.HttpLambdaIntegration(
      'ApiIntegration',
      apiFunction
    );

    httpApi.addRoutes({
      path: '/apply',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: '/status/{applicationId}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: apiIntegration,
    });

    httpApi.addRoutes({
      path: '/approve/{applicationId}',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: apiIntegration,
    });

    // SSM Parameter for API URL (consumed by frontend pipeline)
    new ssm.StringParameter(this, 'ApiUrlParameter', {
      parameterName: `/${props.serviceName}/${props.stage}/api-url`,
      stringValue: httpApi.url ?? '',
    });

    // Outputs
    this.apiUrl = new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.url ?? '',
      exportName: `${props.serviceName}-${props.stage}-api-url`,
    });

    new cdk.CfnOutput(this, 'TableName', {
      value: progressTable.tableName,
    });
  }
}
