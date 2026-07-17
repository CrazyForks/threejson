[中文](../zh/event-mechanism.md) | [English](./event-mechanism.md)

# Event Mechanism And EventScript

ThreeJSON event handling lets JSON object records declare an `events` block. At runtime, the event system binds platform events and executes declarative actions, EventScript, or optional JavaScript handlers.

## Architecture

| Component | Responsibility |
|-----------|----------------|
| `EventBindingRegistry` | Stores `(threeJsonId, eventName) -> binding`. |
| `EventListenerManager` | Lazily attaches DOM listeners and dispatches platform events. |
| `bindEventsFromScene` | Scans scene objects and registers bindings from `userData.objJson.events`. |
| `bindSceneEventRuntime` | Scene-level bind, rebind, and dispose entry. |
| `CoreActionExecutor` | Executes JSON `action` / `actions`. |
| `CoreBindingExecutor` | Executes EventScript or JavaScript bindings. |

Execution order for the same object and event is domain-only binding, JSON actions, script, then runtime handler.

## JSON `events`

```json
{
  "threeJsonId": "event-demo-box",
  "objType": "box",
  "events": {
    "click": {
      "script": "self.moveBy(-30, 0, 0)\nawait wait(400)\nself.moveBy(30, 0, 0)"
    }
  }
}
```

## External scripts and library resources

Use the unified `script` field for inline and external EventScript or JavaScript:

```json
{
  "assetLibrary": [{
    "threeJsonId": "walking-script",
    "assetKind": "eventScript",
    "url": "./scripts/walking.eventscript"
  }],
  "objectList": [{
    "threeJsonId": "actor",
    "objType": "group",
    "events": {
      "object.ready": { "script": "lib://walking-script" }
    }
  }]
}
```

`events.*.script` accepts inline source, `lib://id`, HTTP(S), relative or absolute paths, `blob:`, `data:`, and packaged-resource references supported by the host. A library `eventScript` may contain `source` or `url`. `scriptUrl` remains readable for compatibility but is deprecated; no separate `script://` scheme is necessary.

## EventScript control flow and mathematics

The DSL supports `if`, `while`, `repeat`, C-style `for`, `break`, and `continue`. Arithmetic operators include `+`, `-`, `*`, `/`, `%`, `**`, and `^`. Constants `PI`, `E`, and `TAU` and common math functions such as `sin`, `cos`, `sqrt`, `min`, and `max` are built in.

```text
var angle = 0
repeat (12) {
  self.setPosition(cos(angle) * 8, 0, sin(angle) * 8)
  angle = angle + PI / 6
  await wait(40)
}
```

`sceneConfig.eventScript.maxSteps` also limits loop execution, so accidental infinite loops fail predictably.

## Smooth frame animation

Use an object's `animations` field for smooth runtime changes; do not emulate a render loop with an endless lifecycle script.

```json
{
  "animations": [
    {
      "type": "transform",
      "property": "rotation",
      "from": [0, 0, 0],
      "to": [0, "2 * PI", 0],
      "duration": 2000,
      "repeat": true
    },
    {
      "type": "expression",
      "property": "position",
      "expressions": ["cos(t) * 10", "sin(t * 2) * 2", "sin(t) * 10"]
    }
  ]
}
```

`transform`/`tween` tracks interpolate `position`, `rotation`, or `scale`, with optional `delay`, `repeat`, and `yoyo`. `expression` tracks are evaluated once per render update with `t`/`time`, `delta`, and `progress`. They use the safe numeric expression parser, not JavaScript evaluation.

Three.js already provides the render loop and `Object3D` transform APIs used here. Physics extensions such as Rapier provide rigid-body integration and collision response; they complement, but do not replace, deterministic property or articulated animation.

Prefer declarative `action` / `actions` for simple interaction, and use `script` for more complex behavior. If both are present, actions run before script.

```json
{
  "events": {
    "click": {
      "action": { "type": "object.toggleVisible", "target": "panel-1" },
      "script": "await wait(300)\nself.moveBy(1, 0, 0)"
    }
  }
}
```
