# Contributing

Contributions are welcome! Please open an issue or submit a pull request if you have any suggestions or improvements.

## Development Setup

This project is written in TypeScript and uses Node.js. Install dependencies:

```bash
npm install
```

### Running Locally

```bash
npm run dev    # Watch mode with auto-rebuild
npm start      # Run the built server
```

### Testing

We use Vitest for testing:

```bash
npm test              # Run tests in watch mode
npm test -- --run     # Run tests once
npm run test:coverage # Run with coverage report
```

### Linting and Formatting

```bash
npm run lint          # Check for linting errors
npm run lint:fix      # Fix linting errors automatically
npm run format        # Format code with Prettier
npm run format:check  # Check code formatting
npm run typecheck     # TypeScript type checking
```

### Pre-commit Hooks

This project uses Husky and lint-staged to run checks before commits:
- Prettier formatting
- ESLint fixes
- Automatically runs on staged files only

## Commit Message Format

**IMPORTANT**: This project uses semantic-release for automated versioning. Commit message format determines whether a new version is released.

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Commit Types and Versioning

| Type | Release | Description | Example |
|------|---------|-------------|---------|
| `feat` | ✅ MINOR | New feature | `feat: add RUM waterfall tool` |
| `fix` | ✅ PATCH | Bug fix | `fix: correct trace span parsing` |
| `docs` | ❌ None | Documentation only | `docs: update README` |
| `style` | ❌ None | Code style/formatting | `style: fix indentation` |
| `refactor` | ❌ None | Code refactoring | `refactor: simplify error handling` |
| `perf` | ❌ None | Performance improvement | `perf: optimize log sampling` |
| `test` | ❌ None | Adding/updating tests | `test: add coverage for monitors` |
| `build` | ❌ None | Build system changes | `build: update tsup config` |
| `ci` | ❌ None | CI configuration | `ci: add workflow dispatch` |
| `chore` | ❌ None | Maintenance tasks | `chore: update dependencies` |

### Examples

**Will trigger a patch release (1.0.0 → 1.0.1):**
```
fix: add id-token write permission for npm provenance
```

**Will trigger a minor release (1.0.0 → 1.1.0):**
```
feat: add support for security monitoring signals
```

**Will NOT trigger any release:**
```
docs: improve installation instructions
chore(deps): update dependencies
ci: fix workflow permissions
```

### Breaking Changes

To trigger a major release (1.0.0 → 2.0.0), include `BREAKING CHANGE:` in the commit footer or add `!` after the type:

```
feat!: remove deprecated HTTP transport

BREAKING CHANGE: HTTP transport has been removed in favor of stdio
```

### Why This Matters

The commit message format directly controls versioning:
- Using `fix:` for a configuration change triggers an unnecessary patch release
- Using `chore:` or `ci:` for the same change avoids the release
- This keeps the version history clean and meaningful

When in doubt, use `chore:` for maintenance tasks that don't affect functionality.
