# Development

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [VS Code](https://code.visualstudio.com/) with the Extension Development Host

## Setup

1. Clone the repository
2. Install dependencies and set up git hooks:
   ```bash
   npm install
   ```

## Running the Extension

Open the project in VS Code and press **F5** to launch the Extension Development Host. The extension activates automatically on startup.

## Scripts

| Command                | Description                           |
| ---------------------- | ------------------------------------- |
| `npm run ci`           | Run all checks (test + lint + format) |
| `npm test`             | Run tests (Vitest)                    |
| `npm run lint`         | Lint code (ESLint)                    |
| `npm run lint:fix`     | Lint and auto-fix                     |
| `npm run format`       | Format code with Prettier             |
| `npm run format:check` | Check code formatting                 |

## Project Structure

```
src/
├── extension.js          # Entry point: registers all features
├── toggleQuotes.js       # Toggle Quotes feature
├── highlightLine.js      # Highlight Current Line feature
└── removeTabsOnSave.js   # Remove Tabs on Save feature
tests/
├── toggleQuotes.test.js
└── removeTabsOnSave.test.js
```

## Testing

```bash
npm test     # Run all tests
npm run ci   # Run tests + lint + format check in one step
```

Tests use [Vitest](https://vitest.dev/).

## Local Packaging

```bash
npm install -g @vscode/vsce
vsce package
```

This produces a `.vsix` file that can be installed locally via **Extensions: Install from VSIX**.
