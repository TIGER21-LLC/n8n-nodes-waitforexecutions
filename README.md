# ⏳ n8n-nodes-waitforexecutions

A robust n8n Community Node for orchestrating and synchronizing sub-workflow executions. This node waits for one or more sub-workflow executions to complete, supports retry and timeout logic, and routes items based on execution status.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## ✨ Features

### ⏱️ **Wait For Executions Node**
- **Sub-Workflow Synchronization**: Waits for one or multiple sub-workflow executions to finish before proceeding.
- **Configurable Retry & Timeout**: Set retry limits and execution timeouts for robust error handling.
- **Multi-Output Routing**: Routes items to `done`, `failed`, or `processing` outputs based on execution status.
- **API Integration**: Uses n8n API credentials to fetch execution status and results.
- **Detailed Error Reporting**: Provides clear error messages and output data for failed executions.
- **TypeScript Support**: Full type safety and IntelliSense.

## 🚦 True Parallelism in n8n Queue Mode

To truly get parallelization out of n8n queue mode, your main workflow must continue execution without waiting for all sub-executions to complete. However, the standard "Execute Sub-Workflow" node triggers executions sequentially—waiting for each to finish before starting the next. This means you only ever have one new execution at a time, underutilizing available worker nodes.

If you set "Wait for Completion" to false, all sub-workflows are triggered at once, maximizing worker usage. But then, your main workflow can't access the sub-workflow outputs directly.

**WaitForExecutions solves this problem.**  
Place it after "Execute Sub-Workflow" (with "Wait for Completion" = false). This node checks the status of each execution and routes items through three outputs: `done`, `failed`, and `processing`. By connecting a "Wait" node to the `processing` output and looping back, you create a smart polling system that advances completed items and keeps checking pending ones—until a retry or timeout limit is reached (both configurable). You can also choose to wait for all executions to complete before moving forward.

This approach allows you to fully utilize n8n's queue mode and all available workers, making your workflows much more powerful and efficient.

## 📦 Installation

Install the node using n8n's Community Nodes feature:

1. **Via n8n Interface:**
   - Go to **Settings** → **Community Nodes**
   - Install package: `@tiger21/n8n-nodes-waitforexecutions`

2. **Via npm (for self-hosted n8n):**
   ```bash
   npm install @tiger21/n8n-nodes-waitforexecutions
   ```

For more details, see the [n8n Community Nodes documentation](https://docs.n8n.io/integrations/community-nodes/installation/).

## 🚀 Usage

### Problem Solved

Problem Solved

- Wait for all sub-executions to complete before proceeding.
- Retry status checks with configurable limits.
- Fail gracefully if executions error, crash, or timeout.
- Achieve true parallelism in queue mode by polling for completion.

### Basic Usage

1. **Trigger sub-workflows** using the "Execute Sub-Workflow" node with "Wait for Completion" set to false.
2. **Pass execution IDs** to the WaitForExecutions node (in item metadata).
3. **Configure retry and timeout** parameters as needed.
4. **Connect outputs**:
   - `done`: All executions completed successfully.
   - `failed`: One or more executions failed or timed out.
   - `processing`: Still waiting for executions to finish (loop this back with a "Wait" node).

### Output Structure

Output Structure
- `execution_id`: The sub-execution ID.
- `execution_output`: The result data or error details.

execution_output: The result data or error details.
```json
Example:
  "execution_id": "12345",
  "execution_output": {
    "data": { ... }, // Result data if successful
    "error": "Execution with ID 12345 failed. Status: error"
  }
}
```

## ⚙️ Configuration

### Parameters

| Parameter                  | Type    | Default | Description                                                                 |
|----------------------------|---------|---------|-----------------------------------------------------------------------------|
| **Wait For All Executions**| Boolean | false   | Wait for all executions to finish before outputting, or emit as each finishes|
| **Retry Limit**            | Number  | 5       | Number of status checks before considering an execution failed               |
| **Execution Timeout (s)**  | Number  | 1       | Maximum time (in seconds) to wait for an execution before failing            |

## 💡 Use Cases

### 1. **Orchestrating Parallel Sub-Workflows**
```
Start Sub-Workflow 1 ──┐
Start Sub-Workflow 2 ──┤── [WaitForExecutions] ──> Continue Processing
Start Sub-Workflow 3 ──┘
```

### 2. **Batch Processing with Error Handling**
- Wait for all batch jobs to finish, retrying as needed, and handle failures gracefully.

### 3. **Timeout-Sensitive Automation**
- Ensure downstream steps only proceed if all sub-workflows complete within a set time.

## 🔧 Development

### Prerequisites

- Node.js 20+
- npm 8+
- n8n development environment

### Setup

```bash
	 Setup
# Clone the repository
git clone https://github.com/TIGER21-LLC/n8n-nodes-waitforexecutions.git
cd n8n-nodes-waitforexecutions

# Install dependencies
npm install

# Build and run in dev mode
```

### Project Structure

```
Project Structure
n8n-nodes-waitforexecutions/
├── nodes/
│   └── WaitForExecutions/
│       ├── WaitForExecutions.node.ts   # Main node implementation
│       └── WaitForExecutions.node.json # Node metadata
├── dist/
├── test/
├── gulpfile.js
```

## 🤝 Contributing

🤝 Contributing

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run build and tests: `npm run build:test`
5. Submit a pull request

## 🐛 Troubleshooting

### Common Issues

**❌ "No sub-execution ID found" Error**
- Ensure each input item contains a valid sub-execution ID in its metadata. AKA make sure "Execute Sub-Workflow" node immediately precedes this node in the workflow.

**❌ Timeout or Retry Failures**
- Increase the retry limit or timeout value in node configuration.
- Check that sub-workflows are running and reachable via the n8n API.

**❌ API Authentication Errors**
- Verify that n8n API credentials are correctly configured. For base url, use the n8n instance URL with API prefix (e.g., `http://localhost:5678/api/v1`).

## 📚 Resources

- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/community-nodes/)
- [n8n Node Development Guide](https://docs.n8n.io/integrations/creating-nodes/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for the [n8n](https://n8n.io) automation platform
- Inspired by the need for robust sub-workflow orchestration and true parallelism in n8n

---

**Made with ❤️ for the n8n community**
