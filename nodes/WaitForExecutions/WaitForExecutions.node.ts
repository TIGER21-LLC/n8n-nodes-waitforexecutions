import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

type N8nApiCredentials = {
	apiKey: string;
	baseUrl: string;
};

export class WaitForExecutions implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wait For Executions',
		name: 'waitForExecutions',
		icon: 'file:waitForExecutions.svg',
		group: ['transform'],
		version: 1,
		description: 'Waits for sub-workflow executions to complete before proceeding. Excepts executionId in the input data or metadata.',
		defaults: {
			name: 'Wait For Executions',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main],
		outputNames: ['done', 'failed'],
		credentials: [
			{
				name: 'n8nApi',
				required: true,
			},
		],
		requestDefaults: {
			returnFullResponse: true,
			baseURL: '={{ $credentials.baseUrl.replace(new RegExp("/$"), "") }}',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Wait (Seconds)',
				name: 'wait',
				type: 'number',
				default: 5,
				placeholder: 'Number of seconds to wait before re-checking the status of executions.',
				description: 'Number of seconds to wait before re-checking the status of executions',
			},
			{
				displayName: 'Retry Limit',
				name: 'retry_limit',
				type: 'number',
				default: 0,
				placeholder:
					'Maximum number of retries before considering an execution failed. Set to 0 for infinite retries.',
				description:
					'Maximum number of retries before considering an execution failed. Set to 0 for infinite retries.',
			},
			{
				displayName: 'Execution Timeout (Seconds)',
				name: 'execution_timeout',
				type: 'number',
				default: 0,
				placeholder:
					'Maximum execution time before considering an execution failed. Set to 0 to ignore.',
				description:
					'Maximum execution time before considering an execution failed. Set to 0 to ignore.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const wait = this.getNodeParameter('wait', 0, 5) as number;
		const retryLimit = this.getNodeParameter('retry_limit', 0, 0) as number;
		const executionTimeout = this.getNodeParameter('execution_timeout', 0, 0) as number;

		let items = this.getInputData();

		let doneItems: INodeExecutionData[] = [];
		let failedItems: INodeExecutionData[] = [];
		let processingItems: INodeExecutionData[] = items;

		let attempts = 0; // Global attempts counter

		const checkExecutionStatuses = async function checkExecutionStatuses(
			context: IExecuteFunctions,
			items: INodeExecutionData[],
			executionTimeout: number,
		): Promise<{
			doneItems: INodeExecutionData[];
			failedItems: INodeExecutionData[];
			processingItems: INodeExecutionData[];
		}> {
			const doneItems: INodeExecutionData[] = [];
			const failedItems: INodeExecutionData[] = [];
			const processingItems: INodeExecutionData[] = [];

			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				const item = items[itemIndex];

				let status: 'done' | 'failed' | 'processing' = 'processing';
				let output_data: any = undefined;

				// Step 1: Check if we have an execution ID (prefer item.json.executionId, fallback to metadata.subExecution?.executionId)
				const executionId =
					(item.json.execution_id as string | undefined) ??
					(item.metadata?.subExecution?.executionId ?? null);

				if (!executionId) {
					status = 'failed';
					output_data = {
						error: 'No execution ID found in item input or metadata. Cannot proceed.',
					};
					item.json.execution_output = output_data;
					failedItems.push(item);
					continue;
				}

				item.json.execution_id = executionId;

				// Step 4: Get Execution Summary from n8n API
				const credentials = await context.getCredentials<N8nApiCredentials>('n8nApi');
				const baseUrl = credentials.baseUrl;

				const options = {
					url: `${baseUrl.replace(new RegExp('/$'), '')}/executions/${executionId}`,
					method: 'GET' as const,
					qs: {
						includeData: true,
					},
					json: true,
				};

				let execution;

				try {
					execution = await context.helpers.httpRequestWithAuthentication.call(
						context,
						'n8nApi',
						options,
					);
				} catch (error) {
					if (error instanceof NodeApiError) {
						throw error;
					}
					throw new NodeApiError(context.getNode(), error as JsonObject);
				}

				// Step 5: Check if execution exists

				if (!execution) {
					status = 'failed';
					output_data = {
						error: `Execution with ID ${executionId} not found.`,
					};
					item.json.execution_output = output_data;
					failedItems.push(item);
					continue;
				}

				const extractNodeOutput = (data: any) => {
					try {
						return data[0].data.main[0];
					} catch (e) {
						return data;
					}
				};

				// Step 6: Check execution status and determine output
				switch (execution.status) {
					case 'success':
						status = 'done';
						output_data = {
							data: execution.data.resultData.lastNodeExecuted
								? extractNodeOutput(
										execution.data.resultData.runData[execution.data.resultData.lastNodeExecuted],
									)
								: [],
						};
						break;
					case 'canceled':
					case 'crashed':
					case 'error':
						status = 'failed';
						output_data = {
							error: `Execution with ID ${executionId} failed. Status: ${execution.status}`,
							data: execution.data.resultData.error,
						};
						break;
					case 'running':
					case 'new':
					case 'waiting':
					case 'unknown':
						// Check timeout if still processing/unknown
						if (executionTimeout !== 0 && execution.startedAt) {
							const startedAt = new Date(execution.startedAt).getTime();
							const now = Date.now();
							const timeoutMs = executionTimeout * 1000; // Convert Seconds to milliseconds
							if (now - startedAt > timeoutMs) {
								output_data = {
									error: `Execution timed out after ${executionTimeout} second(s).`,
								};
								status = 'failed';
							} else {
								status = 'processing';
							}
						} else {
							status = 'processing';
						}
						break;
					default:
						status = 'processing';
				}

				if (output_data) {
					item.json.execution_output = output_data;
				}
				if (status === 'done') {
					doneItems.push(item);
				} else if (status === 'failed') {
					failedItems.push(item);
				} else {
					processingItems.push(item);
				}
			}

			return { doneItems, failedItems, processingItems };
		};

		while (processingItems.length > 0) {
			attempts++; // Increment global attempts

			const result = await checkExecutionStatuses.call(
				this,
				this,
				processingItems,
				executionTimeout,
			);
			doneItems = doneItems.concat(result.doneItems);
			failedItems = failedItems.concat(result.failedItems);
			processingItems = result.processingItems;

			if (retryLimit !== 0 && attempts >= retryLimit && processingItems.length > 0) {
				for (const item of processingItems) {
					item.json.execution_output = {
						error: `Exceeded global retry limit of ${retryLimit}. Attempts: ${attempts}`,
					};
					failedItems.push(item);
				}
				processingItems = [];
				break;
			}

			if (processingItems.length > 0) {
				await new Promise((resolve) => {
					const timer = setTimeout(() => resolve([this.getInputData()]), wait * 1000);
					this.onExecutionCancellation(() => clearTimeout(timer));
				});
			}
		}

		return [doneItems, failedItems];
	}
}
