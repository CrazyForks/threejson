# 运行时动画、事件与脚本

ThreeJSON 的动态行为分为四层：声明式 actions 负责离散变更，对象的 `animations` 负责平滑逐帧动画，EventScript 负责有控制流的交互逻辑，生命周期事件负责在场景或对象装载、销毁时启动和清理行为。

## 坐标、旋转与数值表达式

`position`、`rotation`、`scale` 均支持对象和数组形式：

```json
{
  "position": [1, 2, 3],
  "rotation": { "x": 0, "y": "PI / 2", "z": 0 },
  "scale": [1, 1, 1]
}
```

旋转单位为弧度。安全数值表达式支持 `PI`、`E`、`TAU`，四则运算、余数、乘方、括号，以及常用三角和数学函数。兼容层仍能读取旧的 `rotationX`、`scaleX` 字段，但新 JSON 和 AI 输出只应使用 `x`、`y`、`z`。

## 平滑逐帧动画

Three.js 提供渲染循环和 `Object3D` 变换 API；ThreeJSON 在现有渲染循环中更新动画，无需用无限脚本循环模拟帧。

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

`transform`（或 `tween`）支持 `position`、`rotation`、`scale` 的 `from`、`to`、`duration`、`delay`、`repeat`、`yoyo`。`expression` 每帧提供 `t`/`time`（秒）、`delta` 和 `progress`，表达式由安全解析器执行，不使用 `eval`。

人物行走可把人物整体放在父组中：父组沿路径移动，左右腿作为子对象以相反相位往复旋转；摆手、回头同理。需要绕某点运动时，既可对位置写时间表达式，也可使用额外父组作为转轴。这些都是通用组合方式，不是针对某类提示词的特殊分支。

## EventScript 循环与数学

DSL 支持 `if`、`while`、`repeat`、C 风格 `for`、`break`、`continue`，并支持算术运算、`PI`/`E`/`TAU` 和常用数学函数。循环仍受 `sceneConfig.eventScript.maxSteps` 限制，防止意外死循环。

```text
var angle = 0
repeat (12) {
  self.setPosition(cos(angle) * 8, 0, sin(angle) * 8)
  angle = angle + PI / 6
  await wait(40)
}
```

生命周期脚本适合初始化和清理，不应在 `scene.ready` 或 `object.ready` 中写永不结束的逐帧循环。

## 外部脚本

统一使用 `events.*.script`。它可直接写源码，也可引用 HTTP(S)、相对/绝对路径、`blob:`、`data:`、宿主支持的包资源，或 `lib://id`。`assetLibrary` 中 `assetKind: "eventScript"` 的资源可以提供 `source` 或 `url`。旧 `scriptUrl` 仅作为兼容输入保留，不另造 `script://` 协议。

```json
{
  "assetLibrary": [{
    "threeJsonId": "actor-script",
    "assetKind": "eventScript",
    "url": "./scripts/actor.eventscript"
  }],
  "objectList": [{
    "threeJsonId": "actor",
    "objType": "group",
    "events": {
      "object.ready": { "script": "lib://actor-script" }
    }
  }]
}
```

## 物理引擎的边界

Rapier 等物理扩展支持固定步长刚体积分、碰撞和物理约束，因此物理运动通常是平滑的；但它不应替代确定性的属性补间、角色关节动画或材质变化。只有用户意图确实要求重力、碰撞、反弹、摩擦或关节约束时，才需要选择物理能力。

## AI 提示词装配

ThreeBox 的动画能力模式为 `自动`、`始终开启`、`关闭`。自动模式由正式生成前的供应商模型协商决定是否需要动画，并结构化返回所需能力 ID；core/ai 只解析结果并按需装配对应语法和示例，不用关键词在本地猜测用户意图。
