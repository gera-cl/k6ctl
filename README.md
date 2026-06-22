# k6ctl

A CLI tool to simplify running k6 tests on Kubernetes using the k6-operator.

## Overview

`k6ctl` eliminates the need to manually run `kubectl` commands to create ConfigMaps, apply TestRun manifests, and manage k6 tests in Kubernetes. Instead, you configure your test settings once and run tests with a simple command.

## Installation

```bash
npm install -g k6ctl
```

Or use it directly with npx:

```bash
npx k6ctl run path/to/test.js
```

## Configuration

Create a `k6ctl.config.json` file in the root of your project (or pass another file with `--config`).

Example:

```json
{
	"namespace": "default",
	"parallelism": 1,
	"arguments": ["--summary-mode=full"],
	"cleanup": false,
	"quiet": true,
	"separate": false,
	"runner": {
		"image": "grafana/k6:latest",
		"resources": {
			"limits": {
				"cpu": "500m",
				"memory": "512Mi"
			},
			"requests": {
				"cpu": "250m",
				"memory": "256Mi"
			}
		}
	},
	"prometheus": {
		"serverUrl": "http://prometheus-server.monitoring.svc.cluster.local:9090/api/v1/write",
		"trendStats": ["avg", "p(95)", "p(99)", "min", "max"]
	}
}
```

If this file does not exist, `k6ctl` falls back to defaults.

### Hooks

Run commands before the test is submitted with `hooks.preRun`. Each hook receives context via environment variables:

| Variable | Description |
|---|---|
| `K6CTL_SCRIPT_PATH` | Path to the test script |
| `K6CTL_NAMESPACE` | Target namespace |
| `K6CTL_PARALLELISM` | Parallelism value |
| `K6CTL_HOOK_PHASE` | `pre-run` |

```json
{
  "hooks": {
    "preRun": [
      {
        "name": "build",
        "command": "npm run build",
        "timeout": 60,
        "continueOnError": false,
        "workingDir": "./"
      }
    ]
  }
}
```

Hook fields:

- `name`: Display name for the hook
- `command`: Shell command to run
- `timeout`: Seconds before the hook is killed (default: `60`)
- `continueOnError`: If `true`, a failing hook does not abort the run (default: `false`)
- `workingDir`: Working directory for the command (optional)

Use `--skip-hooks` on `k6ctl run` to bypass all hooks, or `--skip-pre-hooks` to skip only pre-run hooks.

## Usage

### Step-by-step workflow

1. Prepare your test scripts and config.
2. Run a test with `k6ctl run ...`.
3. Inspect state with `k6ctl status`.
4. Read pod output with `k6ctl logs`.
5. List resources with `k6ctl list`.
6. Clean up with `k6ctl delete`.

`k6ctl run` stores run metadata in `.k6ctl-last-run.json` in your current directory. Commands like `status`, `logs`, and default `delete` use this file.

### Run command

Run a specific test file:

```bash
k6ctl run large-test-1.js
```

Run with a custom scripts directory for interactive selection:

```bash
k6ctl run -d dist/tests
```

When no script argument is provided, `k6ctl` scans the folder provided by `-d, --dir` (default: `dist/tests`) and prompts you to choose a `.js` script.

Run with smart analysis enabled:

```bash
k6ctl run large-test-1.js --smart
```

`--smart` analyzes supported scenarios (currently `ramping-arrival-rate`) and automatically adjusts values such as recommended VUs and parallelism before submission.

Run using volume (PVC-backed flow):

```bash
k6ctl run large-test-1.js
```

`k6ctl` switches to volume flow automatically when the generated k6 archive is larger than 1 MB. In this mode, it creates a PVC, uploads the archive through a temporary helper pod, and mounts that PVC in the TestRun.

There is no explicit `--volume` flag.

Recommended steps for volume flow:

1. Run your test as usual with `k6ctl run <script>`.
2. Confirm logs mention: `exceeds 1 MB, using volume flow`.
3. Check created resources:

```bash
k6ctl status
kubectl get pvc -n <namespace>
kubectl get pods -n <namespace>
```

4. Review pod logs when needed:

```bash
k6ctl logs -n <namespace>
```

5. Clean up resources after the run:

```bash
k6ctl delete
```

By default, `k6ctl delete` removes both the TestRun and the associated script resource (ConfigMap or PVC). Use `--keep-script` only if you need to preserve the script resource.

Run options:

- `-c, --config <path>`: Path to config file (default: `k6ctl.config.json`)
- `-n, --namespace <namespace>`: Kubernetes namespace
- `-p, --parallelism <number>`: Number of parallel test pods
- `-v, --verbose`: Enable debug logging
- `-d, --dir <path>`: Folder to search for `.js` test files (default: `dist/tests`)
- `--smart`: Enable smart scenario analysis

### List command

List all supported resource types in namespace `default`:

```bash
k6ctl list
```

List only pods:

```bash
k6ctl list pods -n load-tests
```

List command syntax:

```bash
k6ctl list [pods|testruns|configmaps] [-n <namespace>]
```

If no type is provided, `all` is used.

### Status command

Show the status of the last saved run:

```bash
k6ctl status
```

Override namespace:

```bash
k6ctl status -n load-tests
```

This prints TestRun details and related pod status.

Status options:

- `-n, --namespace <namespace>`: Kubernetes namespace
- `-v, --verbose`: Show extra columns (node name, etc.)

### Logs command

Show logs for pods linked to the last saved run:

```bash
k6ctl logs
```

Stream logs in real-time:

```bash
k6ctl logs --follow
```

Filter by pod type and show only the last 50 lines:

```bash
k6ctl logs --type runner --tail 50
```

Logs options:

- `-n, --namespace <namespace>`: Kubernetes namespace
- `-f, --follow`: Stream logs in real-time
- `-t, --tail <lines>`: Number of log lines to show from history (default: 100)
- `-p, --pod <name>`: Show logs from a specific pod
- `--type <type>`: Filter by pod type (`runner`, `initializer`, `starter`)
- `--timestamps`: Show timestamps in log output
- `-c, --container <name>`: Container name to fetch logs from

### Delete command

Delete the last run and its associated script resource (ConfigMap or PVC):

```bash
k6ctl delete
```

Delete last TestRun but keep script resource:

```bash
k6ctl delete --keep-script
```

Delete specific resources directly:

```bash
k6ctl delete -p <pod-name> -n load-tests
k6ctl delete -t <testrun-name> -n load-tests
k6ctl delete -c <configmap-name> -n load-tests
```

Delete command options:

- `-n, --namespace <namespace>`: Kubernetes namespace
- `--keep-script`: Skip deletion of associated script ConfigMap/PVC
- `-p, --pod <name>`: Delete a specific pod
- `-t, --testrun <name>`: Delete a specific TestRun
- `-c, --configmap <name>`: Delete a specific ConfigMap

## Command summary

```bash
k6ctl run [script] [options]
k6ctl list [type] [-n <namespace>]
k6ctl status [-n <namespace>] [-v]
k6ctl logs [-n <namespace>] [-f] [-t <lines>] [-p <pod>] [--type <type>] [--timestamps]
k6ctl delete [--keep-script] [-n <namespace>] [-p <pod>] [-t <testrun>] [-c <configmap>]
```

## Requirements

- Node.js >= 18.0.0
- k6 CLI available on PATH
- kubectl configured with access to your Kubernetes cluster
- k6-operator installed in your cluster

## License

MIT
