import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject
} from 'n8n-workflow';
import {
	NodeApiError,
	NodeConnectionTypes
} from 'n8n-workflow';

type N8nApiCredentials = {
	apiKey: string;
	baseUrl: string;
};

interface WaitForAllMetadata extends IDataObject {
	subExecution?: {
		executionId: string;
		workflowId: string;
	} | null; // subExecution can be null if not set
	attempts?: number;
}

export class WaitForExecutions implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WaitForExecutions',
		name: 'waitForExecutions',
		group: ['transform'],
		version: 1,
		description: 'Waits for sub-workflow executions to complete before proceeding',
		defaults: {
			name: 'Wait For Executions',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main, NodeConnectionTypes.Main],
		outputNames: ['done', 'failed', 'processing'],
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
				displayName: 'Wait For All Executions',
				name: 'wait_for_all',
				type: 'boolean',
				default: false,
				placeholder: 'Wait for all executions to complete',
				description: 'Whether to wait for all executions to complete before passing output to done or pass items one by one as they\'re finished?',
			},
			{
				displayName: 'Retry Limit',
				name: 'retry_limit',
				type: 'number',
				default: 5,
				placeholder: 'Number of times we should check for execution status before considering the execution failed',
				description: 'Whether to wait for all executions to complete before passing output to done or pass items one by one as theyre finished?',
			},
			{
				displayName: 'Execution Timeout (Seconds)',
				name: 'execution_timeout',
				type: 'number',
				default: 1,
				placeholder: 'Maximum execution time allowed before considering an execution failed',
				description: 'Whether to wait for all executions to complete before passing output to done or pass items one by one as theyre finished?',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const doneItems: INodeExecutionData[] = [];
		const failedItems: INodeExecutionData[] = [];
		const processingItems: INodeExecutionData[] = [];

		const waitForAll = this.getNodeParameter('wait_for_all', 0, false) as boolean;
		const retryLimit = this.getNodeParameter('retry_limit', 0, 5) as number;
		const executionTimeout = this.getNodeParameter('execution_timeout', 0, 1) as number;

		const items = this.getInputData();

		const statusResults: Array<{ item: INodeExecutionData; status: string; output_data?: any }> = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const item = items[itemIndex];

			let status: 'done' | 'failed' | 'processing' = 'processing';
			let output_data: any = undefined;

			const metadata = item.metadata as WaitForAllMetadata || { attempts: 0 };

			// Step 1: Check if we have a sub-execution ID
			const executionId = metadata.subExecution?.executionId ?? null;
			if (!executionId) {
				status = 'failed';
				output_data = {
					error: 'No sub-execution ID found in item metadata. Cannot proceed.'
				};
				statusResults.push({ item, status, output_data });
				continue;
			}

			item.json.execution_id = executionId;

			// Step 2: Get and increment attempts
			let attempts = metadata.attempts ?? 0;
			(item.metadata as WaitForAllMetadata).attempts = ++attempts;


			// Step 3: Check if we exceeded retry limit
			if( attempts > retryLimit) {
				status = 'failed';
				output_data = {
					error: `Execution with ID ${executionId} exceeded retry limit of ${retryLimit}. Attempts: ${attempts}`
				};
				statusResults.push({ item, status, output_data });
				continue;
			}

			// GOOD TO PROCEED

			// Step 4: Get Execution Summary from n8n API
			const credentials = await this.getCredentials<N8nApiCredentials>('n8nApi');
			const baseUrl = credentials.baseUrl;

			const options = {
				url: `${baseUrl.replace(new RegExp('/$'), '')}/executions/${executionId}`,
				method: 'GET' as const,
				qs: {
					includeData: true
				},
				json: true,
			};

			let execution;

			try {
				execution = await this.helpers.httpRequestWithAuthentication.call(this, 'n8nApi', options);
			} catch (error) {
				if (error instanceof NodeApiError) {
					throw error;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject);
			}

			// Step 5: Check if execution exists

			if (!execution) {
				status = 'failed';
				output_data = {
					error: `Execution with ID ${executionId} not found.`
				};
				statusResults.push({ item, status, output_data });
				continue;
			}

			const extractNodeOutput = (data: any) => {
				try {
					return data[0].data.main[0];
				} catch (e) {
					return data;
				}
			}

			// Step 6: Check execution status and determine output
			switch (execution.status) {
				case 'success':
					status = 'done';
					output_data = {
						data: execution.data.resultData.lastNodeExecuted ? extractNodeOutput(execution.data.resultData.runData[execution.data.resultData.lastNodeExecuted]) : []
					}
					break;
				case 'canceled':
				case 'crashed':
				case 'error':
					status = 'failed';
					output_data = {
						error: `Execution with ID ${executionId} failed. Status: ${execution.status}`,
						data: execution.data.resultData.error
					};
					break;
				case 'running':
				case 'new':
				case 'waiting':
				case 'unknown':
					// Check timeout if still processing/unknown
					if (execution.startedAt) {
						const startedAt = new Date(execution.startedAt).getTime();
						const now = Date.now();
						const timeoutMs = executionTimeout * 1000; // Convert Seconds to milliseconds
						if (now - startedAt > timeoutMs) {
							output_data = {
								error: `Execution timed out after ${executionTimeout} second(s).`
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

			statusResults.push({ item, status, output_data });
		}

		const allDone = statusResults.every(r => r.status === 'done' || r.status === 'failed');

		for (const { item, status, output_data } of statusResults) {
			// put it in the right output array, based on status, waitForAll and allDone
			if (output_data) {
				item.json.execution_output = output_data;
			}
			if (waitForAll) {
				// Only output when all executions are done or failed
				if (allDone) {
					if (status === 'done') {
						doneItems.push(item);
					} else if (status === 'failed') {
						failedItems.push(item);
					}
				} else {
					processingItems.push(item);
				}
			} else {
				// Output items as soon as they're finished
				if (status === 'done') {
					doneItems.push(item);
				} else if (status === 'failed') {
					failedItems.push(item);
				} else {
					processingItems.push(item);
				}
			}
		}

		return [doneItems, failedItems, processingItems];
	}
}
