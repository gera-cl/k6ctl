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

Create a `k6ctl.config.js` file in the root of your k6 scripts project:

## Usage

Run a k6 test:

```bash
k6ctl run large-test-1.js
```

### Options

### Additional Commands

## Requirements

- Node.js >= 18.0.0
- kubectl configured with access to your Kubernetes cluster
- k6-operator installed in your cluster

## License

MIT
