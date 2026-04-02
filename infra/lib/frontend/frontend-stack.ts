import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';
import * as path from 'path';

interface FrontendStackProps extends cdk.StackProps {
  readonly serviceName: string;
  readonly domainName: string;
  readonly hostedZoneName: string;
}

export class FrontendStack extends cdk.Stack {
  public readonly blueBucketName: string;
  public readonly greenBucketName: string;
  public readonly distributionId: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    // S3 Buckets
    const blueBucket = new s3.Bucket(this, 'BlueBucket', {
      bucketName: `${props.serviceName}-blue-${this.region}-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const greenBucket = new s3.Bucket(this, 'GreenBucket', {
      bucketName: `${props.serviceName}-green-${this.region}-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    this.blueBucketName = blueBucket.bucketName;
    this.greenBucketName = greenBucket.bucketName;

    // Origin Access Identity
    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI');
    blueBucket.grantRead(oai);
    greenBucket.grantRead(oai);

    // Lambda@Edge functions
    const edgeHandlersPath = path.join(__dirname, '..', '..', 'src', 'edge-handlers');

    const viewerRequestFn = new NodejsFunction(this, 'ViewerRequestFn', {
      entry: path.join(edgeHandlersPath, 'viewer-request.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X, // Lambda@Edge may not support 22 yet; use 20 for safety
      architecture: lambda.Architecture.X86_64, // Lambda@Edge requires x86_64
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      bundling: {
        minify: true,
        define: {
          BLUE_BUCKET_DOMAIN: JSON.stringify(blueBucket.bucketRegionalDomainName),
          GREEN_BUCKET_DOMAIN: JSON.stringify(greenBucket.bucketRegionalDomainName),
        },
      },
    });

    const originRequestFn = new NodejsFunction(this, 'OriginRequestFn', {
      entry: path.join(edgeHandlersPath, 'origin-request.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X, // Lambda@Edge may not support 22 yet; use 20 for safety
      architecture: lambda.Architecture.X86_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      bundling: {
        minify: true,
        define: {
          BLUE_BUCKET_DOMAIN: JSON.stringify(blueBucket.bucketRegionalDomainName),
          GREEN_BUCKET_DOMAIN: JSON.stringify(greenBucket.bucketRegionalDomainName),
        },
      },
    });

    // ACM Certificate
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.hostedZoneName,
    });

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // Cache Policy
    const cachePolicy = new cloudfront.CachePolicy(this, 'BlueGreenCachePolicy', {
      cachePolicyName: `${props.serviceName}-blue-green`,
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('x-blue-green-context'),
      cookieBehavior: cloudfront.CacheCookieBehavior.allowList('x-blue-green-context'),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
      defaultTtl: cdk.Duration.days(1),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.days(365),
    });

    // CloudFront Distribution
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessIdentity(blueBucket, {
          originAccessIdentity: oai,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy,
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
        edgeLambdas: [
          {
            functionVersion: viewerRequestFn.currentVersion,
            eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
          },
          {
            functionVersion: originRequestFn.currentVersion,
            eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
          },
        ],
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      domainNames: [props.domainName],
      certificate,
    });

    this.distributionId = distribution.distributionId;

    // Route 53 A Record
    new route53.ARecord(this, 'AliasRecord', {
      zone: hostedZone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(distribution)),
    });

    // Outputs
    new cdk.CfnOutput(this, 'DistributionUrl', {
      value: `https://${distribution.distributionDomainName}`,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      exportName: `${props.serviceName}-distribution-id`,
    });

    new cdk.CfnOutput(this, 'DomainName', {
      value: props.domainName,
    });
  }
}
