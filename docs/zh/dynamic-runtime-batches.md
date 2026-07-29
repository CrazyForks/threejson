[中文](./dynamic-runtime-batches.md) | [English](../en/dynamic-runtime-batches.md)

# 动态运行时批处理

ThreeJSON 常规的对象与描述符 API 面向场景装配和低频编辑更新。当应用需要维护大量、频繁变化的**逻辑视觉实体**（例如遥测点、连接、轨迹或模拟状态）时，应使用本页的 API。

这是一层运行时叠加状态：不会改写 JSON 描述符，不会为每个逻辑实体创建一个 `Object3D`，也不会规定持久化方案。

## 槽位化几何体

```js
import * as THREE from "three";
import {
  createDynamicPointBatch,
  createDynamicSegmentBatch,
  createFrameCommitScheduler
} from "threejson/core";

const nodes = createDynamicPointBatch({
  capacity: 512,
  attributes: {
    position: { itemSize: 3, defaultValue: [0, 0, 0] },
    color: { itemSize: 3, defaultValue: [0.4, 0.9, 0.9] },
    size: { itemSize: 1, defaultValue: 4 },
    activation: { itemSize: 1, defaultValue: 0 }
  }
});

const edges = createDynamicSegmentBatch({
  capacity: 1024,
  attributes: {
    position: { itemSize: 3, defaultValue: 0 },
    color: { itemSize: 3, defaultValue: [0.3, 0.8, 0.8] },
    opacity: { itemSize: 1, defaultValue: 0.5 }
  }
});

scene.add(
  new THREE.Points(nodes.geometry, pointMaterial),
  new THREE.LineSegments(edges.geometry, lineMaterial)
);
```

`set(id, values)` 会创建或替换实体：未给出的属性会重置为 schema 默认值；`patch(id, values)` 只改写给出的属性，其余保持原值（但新建实体时仍会先写入默认值，避免继承被交换删除的前一个实体的残留数据）；`remove(id)` 采用稠密交换删除，因此绘制范围紧凑，不会留下可见空槽。

单顶点实体的 `position` 为 `[x, y, z]`；两顶点线段实体的 `position` 为 `[x0, y0, z0, x1, y1, z1]`。属性值若只给出一个顶点的 `itemSize` 个分量，会自动复制到该逻辑实体的每个顶点。

完成一组改动后调用 `commit()`。批处理器只标记累积变化的属性范围供 GPU 上传。容量扩展时会进行一次完整上传，但采用几何扩容，正常情况下不会频繁发生。

扩容还会用更大的 `BufferAttribute` 替换原有属性，被替换的 GPU 缓冲要等渲染器释放旧属性后才回收（最迟在 `geometry.dispose()` 时）。常规频率下无碍；但对于规模大、增删频繁的批处理，建议按预期峰值预先设置 `capacity`，避免在热路径上反复扩容。

## 按帧合并与按需渲染

每个视口或图层组可使用一个调度器，把多次输入合并到一帧。它不替代应用的输入队列或网络协议，只约束 GPU 提交和视觉失效刷新。

```js
const commits = createFrameCommitScheduler();

function applyNodeDelta(id, delta) {
  nodes.patch(id, delta);
  commits.enqueue("nodes", () => {
    nodes.commit();
    runtime.invalidate();
  });
}
```

静态或由增量驱动的视口可选择按需渲染：

```js
const runtime = createSceneRuntime({
  canvas,
  config: {
    renderLoop: { scheduleMode: "demand", updateAnimations: false }
  }
});
runtime.start(); // 绘制第一帧
```

`runtime.invalidate()` 最多只会再安排一帧。默认仍为 `scheduleMode: "continuous"`；时间动画、粒子模拟或需要持续帧循环的控制器应继续使用默认模式。

## 运行时实体注册表

真实 `Object3D` 仍然使用 `threeJsonId` 与 `objectRegistry`。共享几何体内部的逻辑实体则使用独立的运行时实体注册表：

```js
import {
  createRuntimeContext,
  createSceneRuntime,
  registerRuntimeEntity
} from "threejson/core";

const runtimeContext = createRuntimeContext();
const runtime = createSceneRuntime({ canvas, runtimeContext });

const slot = nodes.set("node:42", { position: [1, 2, 3] });
registerRuntimeEntity({
  id: "node:42",
  ownerId: "node-layer",
  kind: "point",
  handle: { batch: "nodes", slot }
}, runtime.scene);
```

`RuntimeEntityRegistry` 按 `RuntimeContext` 隔离，保存通用 ID、可选 owner/kind、不透明 handle 与 metadata。它不定义这些记录在应用中的业务含义，也不把它们写入场景 JSON。
