import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import { PipelineType } from "aws-cdk-lib/aws-codepipeline";
import * as notifications from "aws-cdk-lib/aws-codestarnotifications";
import type * as sns from "aws-cdk-lib/aws-sns";
import * as pipelines from "aws-cdk-lib/pipelines";
import type { Construct } from "constructs";
import { BackendStage } from "./backend/backend-stage";

interface BackendPipelineStackProps extends cdk.StackProps {
  readonly serviceName: string;
  readonly domainName: string;
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
  /**
   * Slack workspace/channel IDs, forwarded to the synth CodeBuild environment
   * so that self-mutation re-synthesizes with notification wiring intact.
   * These are NOT used to create Slack resources — that's NotificationsStack's
   * job — they're purely for synth environment parity.
   */
  readonly slackWorkspaceId?: string;
  readonly slackChannelId?: string;
}

export class BackendPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BackendPipelineStackProps) {
    super(scope, id, props);

    const synthEnvironment: Record<string, string> = {
      CODESTAR_CONNECTION_ARN: props.codestarConnectionArn,
      GITHUB_OWNER: props.githubOwner,
      GITHUB_REPO: props.githubRepo,
      GITHUB_BRANCH: props.githubBranch,
      SERVICE_NAME: props.serviceName,
      DOMAIN_NAME: props.domainName,
    };
    if (props.slackWorkspaceId)
      synthEnvironment.SLACK_WORKSPACE_ID = props.slackWorkspaceId;
    if (props.slackChannelId)
      synthEnvironment.SLACK_CHANNEL_ID = props.slackChannelId;

    const pipeline = new pipelines.CodePipeline(this, "Pipeline", {
      pipelineType: PipelineType.V2,
      pipelineName: `${props.serviceName}-backend`,
      synth: new pipelines.ShellStep("Synth", {
        input: pipelines.CodePipelineSource.connection(
          `${props.githubOwner}/${props.githubRepo}`,
          props.githubBranch,
          { connectionArn: props.codestarConnectionArn },
        ),
        env: synthEnvironment,
        commands: [
          "npm ci",
          "npm -w backend run build",
          "npm -w backend run test",
          "npm -w infra run build",
          "npx -w infra cdk synth",
        ],
        primaryOutputDirectory: "infra/cdk.out",
      }),
      codeBuildDefaults: {
        partialBuildSpec: codebuild.BuildSpec.fromObject({
          phases: {
            install: {
              "runtime-versions": { nodejs: "22" },
            },
          },
        }),
      },
      crossAccountKeys: false,
    });

    // Dev stage (auto-deploy, no approval)
    pipeline.addStage(
      new BackendStage(this, "Dev", {
        env: props.env,
        stage: "dev",
        serviceName: props.serviceName,
        corsAllowedOrigins: ["*"],
      }),
    );

    // Prod stage (manual approval required)
    pipeline.addStage(
      new BackendStage(this, "Prod", {
        env: props.env,
        stage: "prod",
        serviceName: props.serviceName,
        corsAllowedOrigins: [`https://${props.domainName}`],
      }),
      {
        pre: [new pipelines.ManualApprovalStep("PromoteToProd")],
      },
    );

    // Pipeline notifications (optional) — topic is owned by NotificationsStack
    // and subscribed to a shared SlackChannelConfiguration. We must call
    // buildPipeline() explicitly because CDK Pipelines builds its underlying
    // codepipeline.Pipeline lazily, and NotificationRule needs the concrete
    // pipeline resource as its source.
    if (props.notificationTopic) {
      pipeline.buildPipeline();

      new notifications.NotificationRule(this, "NotificationRule", {
        source: pipeline.pipeline,
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
