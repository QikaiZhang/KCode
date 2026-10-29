---
name: api-testing
description: Use when the user asks to prepare an API test environment, generate or run Postman or Apifox tests, configure API authentication, or investigate API test failures.
---

# API test environment

Use the host's shell/file tools with Postman or Apifox CLI. Prefer the user's chosen tool; when
unspecified, use the installed one (Postman first). These are external CLIs, not built-in MCP tools.
Read `<tool> --help` and relevant subcommand help before constructing commands: CLI formats change.
If neither CLI is installed, prepare portable OpenAPI/collection/environment files and report what
must be installed to execute them. Do not silently switch a requested Apifox workflow to Postman.

1. Inspect project instructions, routes/OpenAPI, existing test assets and startup commands. Reuse
   the project's stack. Determine whether the task needs just API variables/collections or also
   backend, database, migrations, seeded fixtures and Mock services. Infer routine choices from
   existing configuration; ask only for missing URLs, credentials or consequential decisions.
2. Prepare isolated local test services as required. Reuse an existing Compose file or development
   startup command; record services you start and how to stop them. Wait for bounded health checks.
   Never substitute a Mock pass for verification against the actual backend without labeling it.
3. Create project-local test artifacts using the selected CLI's current supported format. Postman:
   inspect `postman environment`, `postman collection`, `postman mock` and their subcommands.
   Apifox: inspect `apifox --help`, then its resource/schema help before creating environments,
   importing definitions or writing cases. Prefer local artifacts; synchronize an external workspace
   only when the user requested it and the target project is known.
4. Use environment variables for base URL, credentials and test ids. Keep actual credentials in
   ignored local files or the tool's credential storage; commit only empty templates. Never echo
   tokens in reports. Exercise the real login flow and extract tokens when the API supports it;
   ask the user for missing account access instead of inventing working credentials.
5. Cover the requested happy path, auth failures, validation and meaningful boundary cases. Chain
   returned ids between dependent calls, isolate fixture data and clean up only data created by
   this run. Derive expected results from the contract rather than current failing responses.
6. Execute the collection/test suite with its environment and a bounded timeout. Save a machine-readable
   report and a human-readable summary using reporters the installed version supports.
   Postman CLI can run local collections without login, but some versions require login for
   `--output`; when unavailable, save console output locally and label it as a text report. Distinguish
   setup errors, transport failures and failed assertions. When code repair is authorized, fix the
   cause and rerun affected cases; stop after three unsuccessful repair rounds with concrete evidence.

Return the tested endpoint/environment, backend-versus-Mock distinction, pass/fail counts, artifact
and report paths, rerun command, services left running and unresolved prerequisites. No real execution
means no claim of passing tests. This ends the workflow.
