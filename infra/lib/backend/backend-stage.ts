import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { BackendStack } from './backend-stack';

interface BackendStageProps extends cdk.StageProps {
  readonly stage: string;
  readonly serviceName: string;
  readonly corsAllowedOrigins: string[];
}

export class BackendStage extends cdk.Stage {
  public readonly apiUrl: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: BackendStageProps) {
    super(scope, id, props);

    const stack = new BackendStack(this, 'BackendStack', {
      stage: props.stage,
      serviceName: props.serviceName,
      corsAllowedOrigins: props.corsAllowedOrigins,
    });

    this.apiUrl = stack.apiUrl;
  }
}
