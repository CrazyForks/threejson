# Prompt and context

- Date: 2026-07-17 (Asia/Shanghai)
- Goal: audit forbidden reverse dependencies and host-layer intrusion, then audit direct dependencies among `editor`, `player`, `shower`, and `threebox`.
- Required boundary: shared implementation must live in `tools/scene-host/shared`; applications must never import another application's internals.
- Clarification from the repository owner: `room-show.html` and `port-show.html` are independent applications outside scene-host. They must not depend on `scene-host/shared`; host-specific door double-click behavior is implemented separately in each application.
- Rejected approach: moving the core-hosted door helper into scene-host shared and continuing to reuse it from root host pages. This violated the clarified ownership boundary.

## Human review

- Reviewer: repository owner (current Codex task)
- Review date: 2026-07-17
- Conclusion: approved with the explicit clarification that only applications inside `tools/scene-host/` may consume its `shared/` layer.
