import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as notifications from "aws-cdk-lib/aws-codestarnotifications";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

interface FrontendPipelineStackProps extends cdk.StackProps {
  readonly serviceName: string;
  readonly domainName: string;
  readonly blueBucketName: string;
  readonly greenBucketName: string;
  readonly distributionId: string;
  readonly codestarConnectionArn: string;
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly githubBranch: string;
  /**
   * Optional SNS topic for pipeline notifications. When provided, a
   * NotificationRule is attached to the pipeline and publishes lifecycle
   * events to this topic. The topic is expected to be owned by
   * NotificationsStack and subscribed to a shared SlackChannelConfiguration.
   */
  readonly notificationTopic?: sns.ITopic;
}

export class FrontendPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendPipelineStackProps) {
    super(scope, id, props);

    const blueBucket = s3.Bucket.fromBucketName(
      this,
      "BlueBucket",
      props.blueBucketName,
    );
    const greenBucket = s3.Bucket.fromBucketName(
      this,
      "GreenBucket",
      props.greenBucketName,
    );

    // Artifacts
    const sourceArtifact = new codepipeline.Artifact("SourceArtifact");
    const buildArtifact = new codepipeline.Artifact("BuildArtifact");

    // Build project
    const buildProject = new codebuild.PipelineProject(this, "BuildProject", {
      projectName: `${props.serviceName}-frontend-build`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        env: {
          "parameter-store": {
            VITE_API_URL: `/${props.serviceName}/prod/api-url`,
          },
        },
        phases: {
          install: {
            "runtime-versions": { nodejs: "22" },
            commands: ["cd frontend", "npm ci"],
          },
          build: {
            commands: ["npm run build"],
          },
        },
        artifacts: {
          "base-directory": "frontend/dist",
          files: ["**/*"],
        },
      }),
    });

    // Grant SSM read for API URL
    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter", "ssm:GetParameters"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${props.serviceName}/*/api-url`,
        ],
      }),
    );

    // Invalidation project
    const invalidationProject = new codebuild.PipelineProject(
      this,
      "InvalidationProject",
      {
        projectName: `${props.serviceName}-frontend-invalidation`,
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
          computeType: codebuild.ComputeType.SMALL,
        },
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            build: {
              commands: [
                `aws cloudfront create-invalidation --distribution-id ${props.distributionId} --paths "/*"`,
              ],
            },
          },
        }),
      },
    );

    invalidationProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${props.distributionId}`,
        ],
      }),
    );

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineType: codepipeline.PipelineType.V2,
      pipelineName: `${props.serviceName}-frontend`,
      restartExecutionOnUpdate: true,
    });

    // Source stage
    pipeline.addStage({
      stageName: "Source",
      actions: [
        new codepipeline_actions.CodeStarConnectionsSourceAction({
          actionName: "GitHub",
          owner: props.githubOwner,
          repo: props.githubRepo,
          branch: props.githubBranch,
          connectionArn: props.codestarConnectionArn,
          output: sourceArtifact,
        }),
      ],
    });

    // Build stage
    pipeline.addStage({
      stageName: "Build",
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: "BuildFrontend",
          project: buildProject,
          input: sourceArtifact,
          outputs: [buildArtifact],
        }),
      ],
    });

    // Deploy Green stage
    pipeline.addStage({
      stageName: "DeployGreen",
      actions: [
        new codepipeline_actions.S3DeployAction({
          actionName: "DeployToGreen",
          bucket: greenBucket,
          input: buildArtifact,
          runOrder: 1,
        }),
        new codepipeline_actions.CodeBuildAction({
          actionName: "InvalidateCache",
          project: invalidationProject,
          input: sourceArtifact,
          runOrder: 2,
        }),
        new codepipeline_actions.ManualApprovalAction({
          actionName: "ApproveGreen",
          additionalInformation: [
            "Test the green deployment before promoting to blue (production).",
            "",
            "To view the green version:",
            `- Add query param: https://${props.domainName}?blue_green=green`,
            "- Or add header: x-blue-green-context: green",
            "",
            "Approve to promote green to blue (production).",
          ].join("\n"),
          externalEntityLink: `https://${props.domainName}?blue_green=green`,
          runOrder: 3,
        }),
      ],
    });

    // Deploy Blue stage
    pipeline.addStage({
      stageName: "DeployBlue",
      actions: [
        new codepipeline_actions.S3DeployAction({
          actionName: "DeployToBlue",
          bucket: blueBucket,
          input: buildArtifact,
          runOrder: 1,
        }),
        new codepipeline_actions.CodeBuildAction({
          actionName: "InvalidateCache",
          project: invalidationProject,
          input: sourceArtifact,
          runOrder: 2,
        }),
      ],
    });

    // Pipeline notifications (optional) — topic is owned by NotificationsStack
    // and subscribed to a shared SlackChannelConfiguration.
    if (props.notificationTopic) {
      new notifications.NotificationRule(this, "NotificationRule", {
        source: pipeline,
        events: [
          "codepipeline-pipeline-pipeline-execution-failed",
          "codepipeline-pipeline-pipeline-execution-succeeded",
          "codepipeline-pipeline-manual-approval-needed",
        ],
        targets: [props.notificationTopic],
      });
    }
  }
}
