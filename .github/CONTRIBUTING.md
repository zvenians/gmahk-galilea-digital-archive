# Contributing

## Development expectations
- Keep changes focused and explain the user-facing effect.
- Prefer clear names, small functions, and explicit error handling.
- Maintain keyboard access, readable contrast, responsive layouts, and reduced-motion support.
- Verify empty, loading, failed, and successful states for changed workflows.
- Do not invent performance figures or security certifications.
- Keep secrets and personal data out of commits. Use `.env.example` as a template only.
- Preserve folder-scope checks, authorization, and permission boundaries for all Drive operations.

## Local checks
Install dependencies and configure only the credentials required by the work being tested.

```sh
npm ci
npm run lint
npm run test
npm run build
```

The build and tests may require environment variables. Report unavailable checks as not run; never claim a pass without execution.

## Pull requests
Use a focused branch. Explain changed routes or components, verification evidence, risks, and rollback considerations. Storage, upload, deletion, and authentication changes require additional review before merging.
