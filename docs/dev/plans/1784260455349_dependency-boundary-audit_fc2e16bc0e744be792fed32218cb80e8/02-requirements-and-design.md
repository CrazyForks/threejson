# Requirements assessment and solution design

## Findings

1. `core/host/hostedContainerDoor.js` imported `domains/door/doorKinematics.js`, violating `domains -> core` dependency direction. It also installed a `document` listener, which is host interaction inside core.
2. No direct source imports were found between `editor`, `player`, `shower`, and `threebox`.
3. Player consumed shared modules through editor-named adapters. Although physically located in shared, this obscured ownership and contradicted the documented player adapter API.
4. Some applications intentionally navigate to editor/player pages. Navigation and the shared preview protocol are integration points, not source-code reuse.

## Design

- Move the container-door host helper to `tools/scene-host/shared/js/hostedContainerDoor.js` for scene-host player use and remove it from core exports.
- Keep root `room-show.html` and `port-show.html` independent by implementing their door-picking listeners locally with the public `door` domain API.
- Introduce host-neutral runtime/sysConfig builders in shared, then expose separate editor and player adapters.
- Add an architecture test that rejects:
  - `core -> domains/extensions/tools`;
  - `domains -> tools`;
  - direct imports between scene-host applications;
  - `scene-host/shared -> application internals`;
  - root room/port hosts importing scene-host shared.

## Risks and rollback

- Removing the host helper from core is an API contraction, but the API itself violated the published core boundary and was used only by repository host pages/tests. Rollback is a file move plus export restoration.
- Local room/port implementations can drift; this is accepted to preserve application ownership. Their implementations use the same public door-domain primitives.

## Acceptance

- Static dependency tests report no violations.
- Door helper tests pass from its shared location.
- Player uses player-named adapters and no editor internals.
- Room/port contain no reference to `scene-host/shared`.
- Full automated test suite passes.
