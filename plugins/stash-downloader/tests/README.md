# Stash Downloader tests

Run the commands below from the `plugins/stash-downloader/` directory. The test suite covers the React/TypeScript client and the Python task backend; it does not require a running Stash server.

## Requirements

- Node.js and npm versions supported by the package's Vite and Vitest dependencies.
- Python 3 for the backend unit tests.

## Run the tests

Install the locked JavaScript development dependencies once:

```sh
npm ci
```

Run the frontend and service tests:

```sh
npm test -- --run
```

Run the Python backend tests:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

The package also provides `npm run type-check`, `npm run lint`, and `npm run test:coverage`. `npm run build:stash` type-checks the UI and rebuilds the bundled Stash plugin asset in `dist/`.

## Coverage

The current suite covers metadata adapters and matching, download behavior, Stash imports and queue recovery, import profiles, theme sampling, shared utilities, and backend URL/path validation and error handling. Add tests beside the relevant service or utility when changing behavior.
