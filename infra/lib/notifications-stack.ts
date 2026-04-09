import * as cdk from "aws-cdk-lib";
import * as chatbot from "aws-cdk-lib/aws-chatbot";
import * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

interface NotificationsStackProps extends cdk.StackProps {
  readonly serviceName: string;
  readonly slackWorkspaceId: string;
  readonly slackChannelId: string;
}

/**
 * Owns the single SlackChannelConfiguration shared by all pipelines.
 *
 * AWS Chatbot only allows one SlackChannelConfiguration per Slack channel, so
 * we centralize it here and expose one SNS topic per pipeline. Each pipeline
 * stack consumes its topic as a NotificationRule target; cross-stack wiring
 * is handled automatically by CDK.
 */
export class NotificationsStack extends cdk.Stack {
  readonly backendPipelineTopic: sns.ITopic;
  readonly frontendPipelineTopic: sns.ITopic;

  constructor(scope: Construct, id: string, props: NotificationsStackProps) {
    super(scope, id, props);

    this.backendPipelineTopic = new sns.Topic(this, "BackendPipelineTopic");
    this.frontendPipelineTopic = new sns.Topic(this, "FrontendPipelineTopic");

    new chatbot.SlackChannelConfiguration(this, "SlackChannel", {
      slackChannelConfigurationName: `${props.serviceName}-pipelines`,
      slackWorkspaceId: props.slackWorkspaceId,
      slackChannelId: props.slackChannelId,
      notificationTopics: [
        this.backendPipelineTopic,
        this.frontendPipelineTopic,
      ],
      loggingLevel: chatbot.LoggingLevel.INFO,
    });
  }
}
