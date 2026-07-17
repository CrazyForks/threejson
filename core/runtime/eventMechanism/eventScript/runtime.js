/**
 * EventScript AST interpreter.
 */

import { log } from "../../../util/logger.js";
import { parseEventScript } from "./parser.js";
import {
  assertScriptObjectType,
  createScriptObjectHandle,
  resolveScriptObject
} from "./scriptObjectHandle.js";
import { createTimerScheduler } from "./timerScheduler.js";
import { resolveEventScriptStepLimit } from "./config.js";
import { runEventScriptCommand } from "./runCommand.js";
import { NUMERIC_CONSTANTS, NUMERIC_FUNCTIONS } from "../../../util/numericExpression.js";

const BREAK_SIGNAL = Symbol("EventScript.break");
const CONTINUE_SIGNAL = Symbol("EventScript.continue");

/**
 * @param {object} ast
 * @param {object} runtimeCtx
 * @param {object} [options]
 */
export async function runEventScriptAst(ast, runtimeCtx, options = {}) {
  const stepLimit = options.stepLimit ?? resolveEventScriptStepLimit(options.sceneConfig);
  const timerScheduler = options.timerScheduler ?? createTimerScheduler();
  /** @type {Map<string, object|null>} */
  const variables = new Map();
  let steps = 0;

  function bumpSteps() {
    steps += 1;
    if (steps > stepLimit) {
      throw new Error(`EventScript exceeded maxSteps (${stepLimit})`);
    }
  }

  async function executeBlock(body = []) {
    for (let i = 0; i < body.length; i++) {
      const signal = await executeStatement(body[i]);
      if (signal === BREAK_SIGNAL || signal === CONTINUE_SIGNAL) return signal;
    }
    return null;
  }

  async function executeStatement(node) {
    bumpSteps();
    if (!node || typeof node !== "object") {
      return;
    }
    switch (node.type) {
      case "AwaitWait":
        await timerScheduler.wait(await evaluateExpression(node.ms));
        return;
      case "Run":
      case "AwaitRun":
        await runEventScriptCommand(node.commandText, runtimeCtx.dispatchCtx ?? {}, {
          sceneConfig: options.sceneConfig
        });
        return;
      case "IfStatement": {
        const test = await evaluateExpression(node.test);
        if (test) {
          return executeBlock(node.consequent?.body ?? []);
        } else if (node.alternate) {
          return executeBlock(node.alternate?.body ?? []);
        }
        return;
      }
      case "WhileStatement":
        while (await evaluateExpression(node.test)) {
          bumpSteps();
          const signal = await executeLoopBlock(node.body?.body ?? []);
          if (signal === BREAK_SIGNAL) break;
        }
        return;
      case "RepeatStatement": {
        const count = Math.max(0, Math.floor(Number(await evaluateExpression(node.count)) || 0));
        for (let i = 0; i < count; i += 1) {
          bumpSteps();
          const signal = await executeLoopBlock(node.body?.body ?? []);
          if (signal === BREAK_SIGNAL) break;
        }
        return;
      }
      case "ForStatement": {
        if (node.init) await executeStatement(node.init);
        while (node.test == null || await evaluateExpression(node.test)) {
          bumpSteps();
          const signal = await executeLoopBlock(node.body?.body ?? []);
          if (signal === BREAK_SIGNAL) break;
          if (node.update) await evaluateExpression(node.update);
        }
        return;
      }
      case "BreakStatement":
        return BREAK_SIGNAL;
      case "ContinueStatement":
        return CONTINUE_SIGNAL;
      case "VarDeclaration": {
        const value = await evaluateExpression(node.init);
        if (node.objType && !assertScriptObjectType(value, node.objType)) {
          log.warn("[eventMechanism] EventScript typed resolve mismatch", {
            name: node.name,
            expected: node.objType,
            actual: value?.objType
          });
          variables.set(node.name, null);
        } else {
          variables.set(node.name, value);
        }
        return;
      }
      case "ExpressionStatement":
        await evaluateExpression(node.expression);
        return;
      case "BlockStatement":
        return executeBlock(node.body ?? []);
      default:
        return;
    }
  }

  async function executeLoopBlock(body = []) {
    for (let i = 0; i < body.length; i += 1) {
      const signal = await executeStatement(body[i]);
      if (signal === BREAK_SIGNAL || signal === CONTINUE_SIGNAL) return signal;
    }
    return null;
  }

  async function evaluateExpression(node) {
    bumpSteps();
    if (!node || typeof node !== "object") {
      return undefined;
    }
    switch (node.type) {
      case "Literal":
        return node.value;
      case "Identifier": {
        if (node.name === "self") {
          return runtimeCtx.self;
        }
        if (node.name === "event") {
          return runtimeCtx.eventName ?? null;
        }
        if (node.name === "payload") {
          return runtimeCtx.payload ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(NUMERIC_CONSTANTS, node.name.toUpperCase())) {
          return NUMERIC_CONSTANTS[node.name.toUpperCase()];
        }
        if (Object.prototype.hasOwnProperty.call(NUMERIC_FUNCTIONS, node.name.toLowerCase())) {
          return NUMERIC_FUNCTIONS[node.name.toLowerCase()];
        }
        if (variables.has(node.name)) {
          return variables.get(node.name);
        }
        throw new Error(`Unknown identifier "${node.name}"`);
      }
      case "ResolveExpression": {
        const tokenValue = await evaluateExpression(node.token);
        const token = String(tokenValue ?? "").trim();
        return resolveScriptObject(token, runtimeCtx);
      }
      case "MemberExpression": {
        const object = await evaluateExpression(node.object);
        if (!object) {
          return undefined;
        }
        return object[node.property];
      }
      case "CallExpression": {
        const args = [];
        for (let i = 0; i < (node.args?.length ?? 0); i++) {
          args.push(await evaluateExpression(node.args[i]));
        }
        if (node.callee?.type === "MemberExpression") {
          const object = await evaluateExpression(node.callee.object);
          const method = object?.[node.callee.property];
          if (typeof method === "function") {
            return method.apply(object, args);
          }
          throw new Error(`Attempted to call missing method "${node.callee.property}"`);
        }
        const callee = await evaluateExpression(node.callee);
        if (typeof callee !== "function") {
          throw new Error("Attempted to call a non-function value");
        }
        return callee(...args);
      }
      case "AssignmentExpression": {
        const value = await evaluateExpression(node.right);
        if (node.left.type === "Identifier") {
          variables.set(node.left.name, value);
          return value;
        }
        if (node.left.type === "MemberExpression") {
          const object = await evaluateExpression(node.left.object);
          if (object) {
            object[node.left.property] = value;
          }
          return value;
        }
        throw new Error("Invalid assignment target");
      }
      case "UnaryExpression": {
        const arg = await evaluateExpression(node.argument);
        if (node.operator === "!") {
          return !arg;
        }
        if (node.operator === "-") {
          return -(Number(arg) || 0);
        }
        return arg;
      }
      case "BinaryExpression": {
        const left = await evaluateExpression(node.left);
        const right = await evaluateExpression(node.right);
        switch (node.operator) {
          case "||":
            return Boolean(left) || Boolean(right);
          case "&&":
            return Boolean(left) && Boolean(right);
          case "==":
          case "===":
            return left == right;
          case "!=":
          case "!==":
            return left != right;
          case "<":
            return left < right;
          case ">":
            return left > right;
          case "<=":
            return left <= right;
          case ">=":
            return left >= right;
          case "+":
            return Number(left) + Number(right);
          case "-":
            return Number(left) - Number(right);
          case "*":
            return Number(left) * Number(right);
          case "/":
            return Number(left) / Number(right);
          case "%":
            return Number(left) % Number(right);
          case "**":
          case "^":
            return Math.pow(Number(left), Number(right));
          default:
            return undefined;
        }
      }
      default:
        return undefined;
    }
  }

  try {
    await executeBlock(ast.body ?? []);
  } finally {
    if (options.disposeTimer !== false && options.timerScheduler == null) {
      timerScheduler.clearAll();
    }
  }
}

/**
 * @param {string} source
 * @param {object} dispatchCtx
 * @param {object} [options]
 */
export async function runEventScript(source, dispatchCtx, options = {}) {
  const ast = parseEventScript(source);
  const self = createScriptObjectHandle(dispatchCtx.object, {
    mutationOptions: options.mutationOptions
  });
  await runEventScriptAst(
    ast,
    {
      self,
      eventName: dispatchCtx.eventName,
      payload: dispatchCtx.nativeEvent ?? dispatchCtx.payload ?? null,
      mutationOptions: options.mutationOptions,
      dispatchCtx
    },
    options
  );
}
