#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import * as dotenv from "dotenv";
import * as path from "path";
import { BackendPipelineStack } from "../lib/backend-pipeline-stack";
import { FrontendPipelineStack } from "../lib/frontend-pipeline-stack";
import { FrontendStack } from "../lib/frontend/frontend-stack";
dotenv.config({ path: path.join(__dirname, "../../.env") });

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const serviceName = process.env.SERVICE_NAME ?? "permitflow";
const domainName = process.env.DOMAIN_NAME ?? "permitflow.cypherchat.io";
const hostedZoneName =
  process.env.HOSTED_ZONE_NAME ?? "permitflow.cypherchat.io";

// Backend pipeline (self-mutating, deploys BackendStack to dev/prod)
new BackendPipelineStack(app, `${serviceName}-backend-pipeline`, {
  env,
  serviceName,
  domainName,
  codestarConnectionArn: process.env.CODESTAR_CONNECTION_ARN ?? "",
  githubOwner: process.env.GITHUB_OWNER ?? "",
  githubRepo: process.env.GITHUB_REPO ?? "permitflow",
  githubBranch: process.env.GITHUB_BRANCH ?? "main",
  slackWorkspaceId: process.env.SLACK_WORKSPACE_ID,
  slackChannelId: process.env.SLACK_CHANNEL_ID,
});

// Frontend infrastructure (must be us-east-1 for Lambda@Edge)
const usEast1Env = { account: env.account, region: "us-east-1" };

const frontendStack = new FrontendStack(app, `${serviceName}-frontend`, {
  env: usEast1Env,
  serviceName,
  domainName,
  hostedZoneName,
});

// Frontend pipeline (blue/green SPA deployment)
new FrontendPipelineStack(app, `${serviceName}-frontend-pipeline`, {
  env: usEast1Env,
  serviceName,
  domainName,
  blueBucketName: frontendStack.blueBucketName,
  greenBucketName: frontendStack.greenBucketName,
  distributionId: frontendStack.distributionId,
  codestarConnectionArn: process.env.CODESTAR_CONNECTION_ARN ?? "",
  githubOwner: process.env.GITHUB_OWNER ?? "",
  githubRepo: process.env.GITHUB_REPO ?? "permitflow",
  githubBranch: process.env.GITHUB_BRANCH ?? "main",
  slackWorkspaceId: process.env.SLACK_WORKSPACE_ID,
  slackChannelId: process.env.SLACK_CHANNEL_ID,
});

app.synth();
