import { onMounted, onUnmounted, ref } from 'vue';
import { ChromeStorageStore } from '../../adapters/ChromeStorageStore';
import { ProfileAuditRepository } from '@lib/profile/ProfileAuditRepository';
import type { ProfileAuditResult } from '@lib/profile/contracts';
import type {
  RuntimeErrorCode,
  StartProfileAuditRequest,
  StartProfileAuditResponse,
} from '@lib/runtimeProtocol';
import { panelBus } from '../lib/panelBus';
import { profileAuditClient, type ProfileAuditClient } from '../lib/profileAuditClient';

interface ProfileAuditRepositoryPort {
  latest(): Promise<ProfileAuditResult | null>;
}

export interface UseProfileAuditOptions {
  client?: Pick<ProfileAuditClient, 'start'>;
  repo?: ProfileAuditRepositoryPort;
  available?: () => boolean;
  createRequestId?: () => string;
}

export function useProfileAudit(options: UseProfileAuditOptions = {}) {
  const client = options.client ?? profileAuditClient;
  const repo = options.repo ?? new ProfileAuditRepository(new ChromeStorageStore());
  const available = options.available ?? (() => panelBus.available());
  const createRequestId = options.createRequestId ?? defaultRequestId;
  const audit = ref<ProfileAuditResult | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let generation = 0;
  let active = true;
  let inFlight: Promise<void> | null = null;

  onMounted(() => {
    const hydrationGeneration = generation;
    void repo
      .latest()
      .then((stored) => {
        if (active && generation === hydrationGeneration && stored) audit.value = stored;
      })
      .catch(() => {});
  });
  onUnmounted(() => {
    active = false;
  });

  const start = (): Promise<void> => {
    if (inFlight) return inFlight;
    const request: StartProfileAuditRequest = {
      type: 'START_PROFILE_AUDIT',
      requestId: createRequestId(),
    };
    generation += 1;
    error.value = null;
    loading.value = true;
    inFlight = executeStart(client, request, available)
      .then((response) => {
        if (!active) return;
        if (!response.ok) {
          error.value = profileAuditErrorHint(response.error.code);
          return;
        }
        if (response.data.requestId !== request.requestId) {
          error.value = profileAuditErrorHint('protocol-error');
          return;
        }
        audit.value = response.data.result;
      })
      .catch(() => {
        if (active) error.value = profileAuditErrorHint('transport-error');
      })
      .finally(() => {
        if (active) loading.value = false;
        inFlight = null;
      });
    return inFlight;
  };

  return { audit, loading, error, start };
}

async function executeStart(
  client: Pick<ProfileAuditClient, 'start'>,
  request: StartProfileAuditRequest,
  available: () => boolean,
): Promise<StartProfileAuditResponse> {
  if (!available()) {
    return {
      ok: false,
      error: { code: 'transport-error', message: 'Extension runtime unavailable', retryable: true },
    };
  }
  return client.start(request);
}

export function profileAuditErrorHint(code: RuntimeErrorCode): string {
  const hints: Record<RuntimeErrorCode, string> = {
    'no-linkedin-tab': 'Сделай активной вкладку LinkedIn и повтори аудит.',
    'not-authenticated': 'Авторизуйся в LinkedIn и повтори аудит.',
    'missing-host-permission': 'Разреши расширению доступ к linkedin.com и повтори аудит.',
    'navigation-failed': 'Не удалось открыть твой профиль LinkedIn. Повтори аудит.',
    'unsupported-dom': 'Не удалось распознать текущую разметку профиля LinkedIn.',
    'transport-error': 'Не удалось связаться с расширением. Повтори аудит.',
    timeout: 'LinkedIn отвечает слишком долго. Повтори аудит.',
    'protocol-error': 'Версии компонентов расширения не совпадают. Перезагрузи расширение.',
    'internal-error': 'Не удалось завершить аудит. Повтори попытку.',
    'no-modules': 'Не удалось запустить аудит.',
    paused: 'Сними паузу Lodestar и повтори аудит.',
    'already-running': 'Дождись завершения текущей операции.',
    'recovery-required': 'Расширение восстанавливает прошлый запуск. Повтори позже.',
    'stale-run': 'Запуск устарел. Повтори аудит.',
  };
  return hints[code];
}

function defaultRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
