import { onMounted, onUnmounted, ref } from 'vue';
import type { RuntimeErrorCode, RuntimeResult } from '@lib/runtimeProtocol';
import type {
  AutopilotHost,
  AutopilotStatus,
  LodestarMessage,
  RunReport,
  StopReason,
} from '@lib/types';
import { runtimeClient, type AutopilotRuntimeClient } from '../lib/runtimeClient';
import { panelBus } from '../lib/panelBus';

export type AutopilotPending = 'starting' | 'stopping' | null;

export interface UseAutopilotOptions {
  beforeStart?: () => Promise<void>;
  client?: AutopilotRuntimeClient;
  createRequestId?: () => string;
}

/** Side-panel view of the worker-owned autopilot state and idempotent commands. */
export function useAutopilot(options: UseAutopilotOptions = {}) {
  const client = options.client ?? runtimeClient;
  const beforeStart = options.beforeStart;
  const createRequestId = options.createRequestId ?? newRequestId;
  const status = ref<AutopilotStatus | null>(null);
  const reports = ref<RunReport[]>([]);
  const startHint = ref<string | null>(null);
  const stage = ref<string | null>(null);
  const pending = ref<AutopilotPending>(null);

  const applyStatus = (next: AutopilotStatus): boolean => {
    if (!isFreshStatus(next, status.value)) return false;
    const previous = status.value;
    status.value = next;
    if (!next.running) {
      stage.value = null;
      const hint = previous?.running ? runStopHint(next.stopReason) : null;
      if (hint) startHint.value = hint;
    } else if (next.stage !== undefined) {
      stage.value = next.stage;
    } else if (next.runId !== previous?.runId) {
      stage.value = null;
    }
    return true;
  };

  const hydrateStatus = async (): Promise<RuntimeResult<AutopilotStatus>> => {
    const result = await client.status();
    if (result.ok) applyStatus(result.data);
    return result;
  };

  const loadReports = async () => {
    reports.value = (await panelBus.request<RunReport[]>({ type: 'LIST_REPORTS' })) ?? [];
  };

  const start = async (host: AutopilotHost = 'tab') => {
    if (pending.value) return;
    pending.value = 'starting';
    startHint.value = null;

    try {
      const request = { type: 'START_AUTOPILOT' as const, host, requestId: createRequestId() };
      if (beforeStart) {
        try {
          await beforeStart();
        } catch {
          startHint.value = 'Не удалось сохранить настройки модулей. Повтори запуск.';
          return;
        }
      }

      const result = await client.start(request);
      if (result.ok) {
        applyStatus(result.data.status);
        return;
      }

      startHint.value = runtimeFailureHint(result.error.code);
      if (shouldRehydrate(result.error.code)) await hydrateStatus();
    } catch {
      startHint.value = runtimeFailureHint('transport-error');
    } finally {
      pending.value = null;
    }
  };

  const stop = async () => {
    if (pending.value) return;
    pending.value = 'stopping';
    startHint.value = null;

    try {
      if (!status.value?.runId) {
        const hydration = await hydrateStatus();
        if (!hydration.ok && !status.value?.runId) {
          startHint.value = runtimeFailureHint(hydration.error.code);
          return;
        }
      }

      const runId = status.value?.runId;
      if (!runId) {
        startHint.value = runtimeFailureHint('stale-run');
        return;
      }

      const result = await client.stop({ type: 'STOP_AUTOPILOT', runId });
      if (result.ok) {
        applyStatus(result.data.status);
        return;
      }

      startHint.value = runtimeFailureHint(result.error.code);
      if (result.error.code === 'stale-run') await hydrateStatus();
    } catch {
      startHint.value = runtimeFailureHint('transport-error');
    } finally {
      pending.value = null;
    }
  };

  const handleBroadcast = (message: LodestarMessage) => {
    if (message.type === 'AUTOPILOT_STATUS') {
      applyStatus(message.status);
      return;
    }
    if (message.type === 'AUTOPILOT_STAGE') {
      if (status.value?.running && status.value.runId === message.runId)
        stage.value = message.label;
      return;
    }
    if (message.type === 'AUTOPILOT_REPORT') void loadReports();
  };

  let off = () => {};
  onMounted(() => {
    // Listener first: a status emitted while the cold-worker GET is pending must win.
    off = panelBus.onMessage(handleBroadcast);
    void hydrateStatus().catch(() => {});
    void loadReports();
  });
  onUnmounted(() => {
    off();
  });

  return { status, stage, reports, startHint, pending, start, stop, loadReports, hydrateStatus };
}

export type UseAutopilot = ReturnType<typeof useAutopilot>;

export function runtimeFailureHint(code: RuntimeErrorCode): string {
  switch (code) {
    case 'no-modules':
      return 'Нет включённых модулей — включи хотя бы один в «Модулях».';
    case 'paused':
      return 'Пауза до завтра. Сними её на дашборде, если нужно запустить сейчас.';
    case 'already-running':
      return 'Автопилот уже запущен — статус обновлён.';
    case 'recovery-required':
      return 'Предыдущий запуск прерван. Дождись восстановления и повтори.';
    case 'stale-run':
      return 'Запуск уже изменился — статус обновлён.';
    case 'no-linkedin-tab':
      return 'Открой вкладку LinkedIn и повтори.';
    case 'missing-host-permission':
      return 'Разреши Lodestar доступ к сайту www.linkedin.com и повтори.';
    case 'navigation-failed':
      return 'Не удалось открыть ленту. Обнови вкладку LinkedIn и повтори.';
    case 'unsupported-dom':
      return 'LinkedIn изменил разметку или язык. Обнови страницу и повтори.';
    case 'transport-error':
      return 'Фоновый процесс расширения недоступен. Перезагрузи расширение и повтори.';
    case 'timeout':
      return 'Расширение не ответило вовремя. Повтори действие.';
    case 'protocol-error':
      return 'Панель и расширение разных версий. Перезагрузи расширение.';
    case 'not-authenticated':
      return 'Авторизуйся в LinkedIn и повтори.';
    case 'internal-error':
      return 'Внутренняя ошибка расширения. Повтори действие.';
  }
}

function shouldRehydrate(code: RuntimeErrorCode): boolean {
  return code === 'already-running' || code === 'recovery-required' || code === 'stale-run';
}

const RUN_STOP_HINT: Partial<Record<StopReason, string>> = {
  unsupported_dom: 'LinkedIn изменил разметку ленты. Обнови страницу и повтори.',
  interrupted: 'Запуск прервался на ленте. Обнови вкладку LinkedIn и повтори.',
  navigation_failed: 'Обнови вкладку LinkedIn и повтори запуск.',
  error: 'Запуск оборвался из-за ошибки. Повтори.',
  risk: 'Запуск остановлен: LinkedIn показал проверку.',
};

function runStopHint(reason: StopReason | undefined): string | null {
  return reason ? (RUN_STOP_HINT[reason] ?? null) : null;
}

function isFreshStatus(next: AutopilotStatus, current: AutopilotStatus | null): boolean {
  if (!current) return true;
  if (next.revision !== current.revision) return next.revision > current.revision;
  return next.runId === current.runId;
}

function newRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `lodestar-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
