# Claude Development Guide

This document provides context for Claude AI when working on this codebase.

## Project Overview

- **Type**: Model Context Protocol (MCP) server for Datadog API
- **Language**: TypeScript
- **Runtime**: Node.js 18+
- **Package Manager**: npm
- **Build Tool**: tsup
- **Test Framework**: vitest
- **Linting**: ESLint + Prettier
- **Release**: semantic-release (automated versioning)

## Project Structure

```
datadog-mcp-server/
├── src/
│   ├── index.ts              # Entry point
│   ├── config/               # Configuration and schemas
│   ├── tools/                # MCP tool implementations
│   ├── transport/            # HTTP and stdio transports
│   └── utils/                # Utilities and helpers
├── tests/                    # Vitest test files
├── dist/                     # Built output (gitignored)
└── .github/workflows/        # CI/CD workflows
```

## Common Tasks

### Development
```bash
npm install        # Install dependencies
npm run dev        # Watch mode with auto-rebuild
npm start          # Run the built server
```

### Testing
```bash
npm test              # Run tests in watch mode
npm test -- --run     # Run tests once
npm run test:coverage # With coverage report
```

### Code Quality
```bash
npm run lint          # Check linting
npm run lint:fix      # Fix linting errors
npm run format        # Format with Prettier
npm run typecheck     # TypeScript type checking
npm run build         # Production build
```

## Commit Message Format

**CRITICAL**: Use conventional commits correctly to avoid unnecessary releases.

### Release Triggers
- `feat:` → Minor release (1.0.0 → 1.1.0)
- `fix:` → Patch release (1.0.0 → 1.0.1)

### Non-Release Types
- `docs:` - Documentation changes
- `style:` - Code formatting
- `refactor:` - Code refactoring
- `test:` - Adding/updating tests
- `chore:` - Maintenance (dependencies, configs)
- `ci:` - CI/CD changes
- `build:` - Build system changes

### Examples

✅ **Correct** - Won't trigger release for config change:
```
ci: add id-token permission for npm provenance
```

❌ **Incorrect** - Triggers unnecessary patch release:
```
fix: add id-token permission for npm provenance
```

## CI/CD Pipeline

### Workflow: `.github/workflows/release.yml`

Runs on every push to `main` and every PR:

1. **Quality Checks**:
   - Linting (ESLint)
   - Formatting (Prettier)
   - Type checking (TypeScript)
   - Tests (Vitest)
   - Build verification

2. **Release** (main branch only):
   - Analyzes commits since last release
   - Determines version bump based on commit types
   - Updates package.json version
   - Publishes to npm with provenance
   - Creates GitHub release with changelog
   - Triggers Docker image build

### Workflow: `.github/workflows/docker.yml`

Triggered by Git tags (created by semantic-release):
- Builds Docker image
- Pushes to ghcr.io/tantiope/datadog-mcp

## Key Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `@datadog/datadog-api-client` - Datadog API client
- `express` - HTTP transport server
- `zod` - Schema validation

## Pre-commit Hooks

Husky + lint-staged runs on commit:
- Prettier formatting (auto-fix)
- ESLint (auto-fix)
- Only runs on staged files (fast)

## Important Notes

- **Never commit directly to main** - Use PRs
- **Commit message format matters** - See section above
- **Tests must pass** - CI enforces this
- **HTTP transport** is supported but stdio is primary
- **Read-only mode** available via --read-only flag
