import test from "node:test";
import assert from "node:assert/strict";

import { evaluateNumericExpression } from "../core/util/numericExpression.js";
import { resolvePosition, resolveRotation, resolveScale } from "../core/util/vectorValue.js";

test("numeric expressions support PI, precedence, powers and math functions", () => {
  assert.ok(Math.abs(evaluateNumericExpression("PI / 2") - Math.PI / 2) < 1e-12);
  assert.equal(evaluateNumericExpression("2 + 3 * 4"), 14);
  assert.equal(evaluateNumericExpression("2 ** 3 + sqrt(9)"), 11);
  assert.ok(Math.abs(evaluateNumericExpression("10*cos(t)", { t: Math.PI }) + 10) < 1e-12);
});

test("transform vectors accept arrays, formulas and legacy prefixed objects", () => {
  assert.deepEqual(resolvePosition([1, "2+3", 4]), { x: 1, y: 5, z: 4 });
  assert.deepEqual(resolveScale({ x: 2, y: 3, z: 4 }), { x: 2, y: 3, z: 4 });
  assert.equal(resolveRotation({ rotationY: "PI/2" }).y, Math.PI / 2);
});
