export const config = {
  progressTableName: process.env.PROGRESS_TABLE_NAME ?? '',
  siteInspectionFunctionName: process.env.SITE_INSPECTION_FUNCTION_NAME ?? '',
  workflowFunctionName: process.env.WORKFLOW_FUNCTION_NAME ?? '',
  serviceName: 'permitflow',
  metricsNamespace: 'PermitFlow',
} as const;
