---
name: no_cargo_build_in_session
description: Never run cargo build or cargo tauri dev — these timeout in this environment
type: feedback
---

Never run `cargo build`, `cargo tauri dev`, or any other long-running Rust compilation commands. They timeout in this environment.

**Why:** User compiles and tests manually in a separate terminal.

**How to apply:** After making Rust code changes, tell the user what was changed and ask them to run the build themselves. Do not attempt to verify compilation via the Bash tool.
