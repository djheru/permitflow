import * as cdk from 'aws-cdk-lib';
import * as pipelines from 'aws-cdk-lib/pipelines';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as chatbot from 'aws-cdk-lib/aws-chatbot';
import * as notifications from 'aws-cdk-lib/aws-codestarnotifications';
import type { Construct } from 'constructs';
import { BackendStage } from './backend/backend-stage';

interface BackendPipelineStackProps extends cdk.StackProps {
  readonly serviceName: string;
  readonly domainName: string;
  readonly codestarConnectionArn: string;
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly githubBranch: string;
  readonly slackWorkspaceId?: string;
  readonly slackChannelId?: string;
}

export class BackendPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BackendPipelineStackProps) {
    super(scope, id, props);

    const pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
      pipelineName: `${props.serviceName}-backend`,
      synth: new pipelines.ShellStep('Synth', {
        input: pipelines.CodePipelineSource.connection(
          `${props.githubOwner}/${props.githubRepo}`,
          props.githubBranch,
          { connectionArn: props.codestarConnectionArn }
        ),
        commands: [
          'npm ci',
          'npm -w backend run build',
          'npm -w backend run test',
          'npm -w infra run build',
          'npx -w infra cdk synth',
        ],
        primaryOutputDirectory: 'infra/cdk.out',
      }),
      crossAccountKeys: false,
    });

    // Dev stage (auto-deploy, no approval)
    pipeline.addStage(
      new BackendStage(this, 'Dev', {
        env: props.env,
        stage: 'dev',
        serviceName: props.serviceName,
        corsAllowedOrigins: ['*'],
      })
    );

    // Prod stage (manual approval required)
    pipeline.addStage(
      new BackendStage(this, 'Prod', {
        env: props.env,
        stage: 'prod',
        serviceName: props.serviceName,
        corsAllowedOrigins: [`https://${props.domainName}`],
      }),
      {
        pre: [new pipelines.ManualApprovalStep('PromoteToProd')],
      }
    );

    // Slack notifications (optional)
    if (props.slackWorkspaceId && props.slackChannelId) {
      const topic = new sns.Topic(this, 'PipelineNotifications', {
        topicName: `${props.serviceName}-backend-pipeline-notifications`,
      });

      new chatbot.SlackChannelConfiguration(this, 'SlackChannel', {
        slackChannelConfigurationName: `${props.serviceName}-backend-pipeline`,
        slackWorkspaceId: props.slackWorkspaceId,
        slackChannelId: props.slackChannelId,
        notificationTopics: [topic],
        loggingLevel: chatbot.LoggingLevel.INFO,
      });

      pipeline.buildPipeline();

      new notifications.NotificationRule(this, 'NotificationRule', {
        source: pipeline.pipeline,
        events: [
          'codepipeline-pipeline-pipeline-execution-failed',
          'codepipeline-pipeline-pipeline-execution-succeeded',
          'codepipeline-pipeline-manual-approval-needed',
        ],
        targets: [topic],
      });
    }
  }
}
