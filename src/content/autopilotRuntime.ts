import { CONTENT_PROTOCOL_VERSION } from '@lib/runtimeProtocol';
import type { LodestarMessage, LinkedInDomContract, StopReason } from '@lib/types';
import type { ContentRunSession } from './runSession';

type RunLoopMessage = Extract<LodestarMessage, { type: 'AUTOPILOT_RUN_LOOP' }>;
type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

export interface ContentRuntimeMessageEvent {
  addListener(listener: RuntimeListener): void;
}

export interface ContentAutopilotRuntimeDependencies {
  session: ContentRunSession;
  currentUrl(): string;
  inspectDom(): LinkedInDomContract;
  startRunLoop(runId: string, modules: RunLoopMessage['modules']): void | Promise<void>;
  endRun(runId: string, reason: StopReason): Promise<void>;
  clearActivity(): void;
}

/** Registers the page-local run protocol boundary used verbatim by the content script. */
export function registerContentAutopilotRuntime(
  event: ContentRuntimeMessageEvent,
  dependencies: ContentAutopilotRuntimeDependencies,
): void {
  event.addListener((raw, _sender, sendResponse) => {
    if (!isRecord(raw) || typeof raw.type !== 'string') return false;
    if (isRunControlType(raw.type) && !hasRunId(raw)) {
      sendResponse({ ok: false, error: 'invalid-run-id' });
      return false;
    }
    const message = raw as LodestarMessage;
    switch (message.type) {
      case 'PING':
        {
          const contract = dependencies.inspectDom();
          sendResponse({
            type: 'PONG',
            protocolVersion: CONTENT_PROTOCOL_VERSION,
            url: dependencies.currentUrl(),
            ...contract,
            activeRunId: dependencies.session.activeRunId,
          });
        }
        return false;

      case 'AUTOPILOT_RUN_LOOP':
        {
          const contract = dependencies.inspectDom();
          if (contract.surface !== 'feed') {
            sendResponse({ ok: false, error: 'wrong-page' });
            return false;
          }
          if (requiredDomUnsupported(contract)) {
            sendResponse({ ok: false, error: 'unsupported_dom' });
            return false;
          }
          const begun = dependencies.session.beginLoop(message.runId);
          if (begun === 'started')
            startRunLoop(message.runId, runnableModules(contract, message.modules), dependencies);
          sendResponse({
            ok: begun !== 'busy' && begun !== 'missing',
            runId: message.runId,
            duplicate: begun === 'duplicate',
            ...(begun === 'busy'
              ? { error: 'different-run-active' }
              : begun === 'missing'
                ? { error: 'run-not-attached' }
                : {}),
          });
        }
        return false;

      case 'AUTOPILOT_ATTACH':
        {
          const attached = dependencies.session.attach(message.runId);
          if (attached === 'attached') dependencies.clearActivity();
          sendResponse({
            ok: attached !== 'busy',
            runId: message.runId,
            duplicate: attached === 'duplicate',
            ...(attached === 'busy' ? { error: 'different-run-active' } : {}),
          });
        }
        return false;

      case 'STOP_AUTOPILOT':
        {
          const stopped = dependencies.session.stop(message.runId);
          if (stopped) dependencies.clearActivity();
          sendResponse({ ok: true, stopped, activeRunId: dependencies.session.activeRunId });
        }
        return false;

      default:
        return false;
    }
  });
}

function requiredDomUnsupported(contract: LinkedInDomContract): boolean {
  // Unknown reaction or comment controls skip that action. They must not abort likes.
  return contract.capabilities.feed === 'unsupported_dom';
}

function runnableModules(
  contract: LinkedInDomContract,
  modules: RunLoopMessage['modules'],
): RunLoopMessage['modules'] {
  if (contract.capabilities.comment !== 'unsupported_dom') return modules;
  return { ...modules, comments: false };
}

function startRunLoop(
  runId: string,
  modules: RunLoopMessage['modules'],
  dependencies: ContentAutopilotRuntimeDependencies,
): void {
  try {
    void Promise.resolve(dependencies.startRunLoop(runId, modules)).catch(() =>
      reportLoopError(runId, dependencies),
    );
  } catch {
    void reportLoopError(runId, dependencies);
  }
}

async function reportLoopError(
  runId: string,
  dependencies: ContentAutopilotRuntimeDependencies,
): Promise<void> {
  if (!dependencies.session.isActive(runId)) return;
  try {
    await dependencies.endRun(runId, 'error');
  } catch {
    dependencies.session.finish(runId);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRunControlType(type: string): boolean {
  return type === 'AUTOPILOT_ATTACH' || type === 'AUTOPILOT_RUN_LOOP' || type === 'STOP_AUTOPILOT';
}

function hasRunId(message: Record<string, unknown>): boolean {
  return typeof message.runId === 'string' && message.runId.trim().length > 0;
}
