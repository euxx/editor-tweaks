"use strict";

// Periodically calls git.refresh so that the SCM Changes view stays up-to-date
// even when VS Code is not focused (VS Code only polls git status while focused).

/**
 * Returns the refresh interval in milliseconds from config, or 0 if disabled.
 * @param {{ get: (key: string, defaultValue?: unknown) => unknown }} config
 * @returns {number} interval in ms, or 0 when the feature is disabled
 */
function getRefreshInterval(config) {
  if (!config.get("enable")) return 0;
  const intervalSec = /** @type {number} */ (config.get("intervalSec", 10));
  return intervalSec > 0 ? intervalSec * 1000 : 0;
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer;

/**
 * Incremented each time startTimer() is called; lets a running tick detect that it has been
 * superseded and should not reschedule itself.
 */
let generation = 0;

/** Optional output channel for diagnostics; set by activate(). */
/** @type {{ appendLine: (msg: string) => void } | undefined} */
let outputChannel;

/**
 * One-shot guard so a chronically failing git.refresh does not flood the output
 * channel — the failure mode is otherwise indistinguishable from "working but
 * silent" without a single log line.
 */
let firstFailureLogged = false;

/**
 * Returns true when git.refresh should be attempted.
 * - Extension unavailable, not yet active, or disabled (git not installed): false.
 * - Extension active with zero repositories: false.
 * - Extension active with repositories: true (only case that triggers a refresh).
 * @param {typeof import('vscode')} vscode
 * @returns {boolean}
 */
function shouldAttemptGitRefresh(vscode) {
  const gitExt = vscode.extensions.getExtension("vscode.git");
  // exports.enabled is false when git is not installed; getAPI(1) would throw in that case
  if (!gitExt?.isActive || !gitExt.exports?.enabled) return false;
  // git.refresh requires at least one workspace folder; running it without one
  // causes the git extension to show "no available repositories" error notification
  if (!vscode.workspace.workspaceFolders?.length) return false;
  return gitExt.exports.getAPI(1).repositories.length > 0;
}

/**
 * Executes one refresh tick and reschedules itself, unless superseded by a newer startTimer() call.
 * Uses setTimeout (not setInterval) so a slow git.refresh never causes concurrent calls.
 * @param {typeof import('vscode')} vscode
 * @param {number} intervalMs
 * @param {number} gen - generation this tick belongs to
 */
async function tick(vscode, intervalMs, gen) {
  // Skip when VS Code is focused — it polls git status automatically while focused
  if (!vscode.window.state.focused) {
    try {
      if (shouldAttemptGitRefresh(vscode)) {
        await vscode.commands.executeCommand("git.refresh");
      }
    } catch (err) {
      // Silently skip subsequent failures — surfacing a notification every
      // intervalSec seconds when git is misconfigured is extremely disruptive.
      // But log the first failure so the silent-skip behaviour is diagnosable.
      if (!firstFailureLogged && outputChannel) {
        firstFailureLogged = true;
        outputChannel.appendLine(
          `[gitAutoRefresh] git.refresh failed (further failures will be silenced): ${err?.message ?? err}`,
        );
      }
    }
  }
  // Reschedule only if startTimer() has not been called since this tick was created
  if (generation === gen) {
    timer = setTimeout(() => tick(vscode, intervalMs, gen), intervalMs);
  }
}

/**
 * Starts (or restarts) the refresh cycle using the current configuration.
 * Cancels any pending tick first.
 * @param {typeof import('vscode')} vscode
 */
function startTimer(vscode) {
  clearTimeout(timer);
  timer = undefined;
  generation++;

  const intervalMs = getRefreshInterval(
    vscode.workspace.getConfiguration("editorTweaks.gitAutoRefresh"),
  );
  if (intervalMs === 0) return;

  const gen = generation;
  timer = setTimeout(() => tick(vscode, intervalMs, gen), intervalMs);
}

/**
 * @param {import('vscode').ExtensionContext} context
 * @param {{ appendLine: (msg: string) => void }} [out] - optional shared output channel
 */
function activate(context, out) {
  // Lazy-load vscode so the pure getRefreshInterval function remains testable without the extension host
  const vscode = require("vscode");
  outputChannel = out;
  startTimer(vscode);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("editorTweaks.gitAutoRefresh")) {
        startTimer(vscode);
      }
    }),
  );
}

function deactivate() {
  clearTimeout(timer);
  timer = undefined;
  generation++; // invalidate any in-flight tick so it does not reschedule after deactivation
  outputChannel = undefined;
  firstFailureLogged = false;
}

module.exports = { activate, deactivate, getRefreshInterval, shouldAttemptGitRefresh };
