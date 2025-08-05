import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes
} from 'n8n-workflow';

interface WaitForAllMetadata extends IDataObject {
	executionId?: string;
	attempts: number;
	// ...other metadata properties if needed...
}

export class WaitForExecutions implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Wait For Executions',
		name: 'waitForExecutions',
		group: ['transform'],
		version: 1,
		description: 'Waits for sub-workflow executions to complete before proceeding',
		defaults: {
			name: 'WaitForExecutions',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main, NodeConnectionTypes.Main],
		outputNames: ['done', 'failed', 'processing'],
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
				displayName: 'Execution Timeout',
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
		// const retryLimit = this.getNodeParameter('retry_limit', 0, 5) as number;
		// const executionTimeout = this.getNodeParameter('execution_timeout', 0, 1) as number;

		const items = this.getInputData();

		const statusResults: Array<{ item: INodeExecutionData, status: string, outputData?: INodeExecutionData[][] }> = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const item = items[itemIndex];
			const metadata = item.json.metadata as WaitForAllMetadata || { attempts: 0 };

			const executionId = metadata.executionId ?? null;

			if (!executionId) {
				failedItems.push(item);
				continue;
			}

			let status: 'done' | 'failed' | 'processing' = 'processing';
			let outputData: INodeExecutionData[][] | undefined;
			// let timedOut = false;

			// Get and increment attempts
			let attempts = metadata.attempts ?? 0;
			attempts++;
			item.json.metadata = {
				...metadata,
				attempts,
			};

			try {
				const workflowRunData = await this.getExecutionDataById(executionId);
				this.logger.info(`[WaitForAll] ExecutionData for ID: ${executionId}.`, {
					workflowRunData
				});
				status = 'done';
				// status = (() => {
				// 	switch (workflowRunData?.status) {
				// 		case 'canceled':
				// 		case 'crashed':
				// 		case 'error':
				// 			return 'failed';
				// 		case 'new':
				// 		case 'running':
				// 		case 'unknown':
				// 		case 'waiting':
				// 			return 'processing';
				// 		case 'success':
				// 			return 'done';
				// 		default:
				// 			return 'failed';
				// 	}
				// })();
				// outputData = workflowRunData.data as INodeExecutionData[][];
				// // Check executionTimeout (in minutes)
				// if (status === 'processing' && workflowRunData.startedAt) {
				// 	const startedAt = new Date(workflowRunData.startedAt).getTime();
				// 	const now = Date.now();
				// 	const diffMinutes = (now - startedAt) / (1000 * 60);
				// 	if (diffMinutes >= executionTimeout) {
				// 		timedOut = true;
				// 	}
				// }
			} catch (e) {
				status = 'failed';
			}

			// if ((attempts >= retryLimit && status !== 'done') || (timedOut && status === 'processing')) {
			// 	status = 'failed';
			// }

			statusResults.push({ item, status, outputData });
		}

		if (waitForAll) {
			const allDone = statusResults.every(r => r.status === 'done');
			const anyFailed = statusResults.some(r => r.status === 'failed');
			if (allDone) {
				for (const { item, outputData } of statusResults) {
					const out = { json: {
							...item.json, executionOutput: outputData
						}
					};
					doneItems.push(out);
				}
			} else if (anyFailed) {
				for (const { item, status, outputData } of statusResults) {
					if (status === 'failed') {
						const out = { json: {
								...item.json, executionOutput: outputData
							}
						};
						failedItems.push(out);
					}
				}
			} else {
				for (const { item, outputData } of statusResults) {
					const out = { json: {
							...item.json, executionOutput: outputData
						}
					};
					processingItems.push(out);
				}
			}
		} else {
			for (const { item, status, outputData } of statusResults) {
				const out = { json: {
						...item.json, executionOutput: outputData
					}
				};
				if (status === 'done') {
					doneItems.push(out);
				} else if (status === 'failed') {
					failedItems.push(out);
				} else {
					processingItems.push(out);
				}
			}
		}

		return [doneItems, failedItems, processingItems];
	}
}
