<script setup lang="ts">
import { ref, nextTick } from 'vue';
import TopBar from './components/TopBar.vue';
import BottomNav from './components/BottomNav.vue';
import DashScreen from './screens/DashScreen.vue';
import ModulesScreen from './screens/ModulesScreen.vue';
import ReportsScreen from './screens/ReportsScreen.vue';
import SettingsScreen from './screens/SettingsScreen.vue';
import ContentScreen from './screens/ContentScreen.vue';
import InboxScreen from './screens/InboxScreen.vue';
import ProfileAuditScreen from './screens/ProfileAuditScreen.vue';
import { useNavigation, type ViewId } from './composables/useNavigation';
import { useSsi } from './composables/useSsi';
import { useProfileViews } from './composables/useProfileViews';
import { useModules } from './composables/useModules';
import { useAutopilot } from './composables/useAutopilot';
import { startPanelAccount } from './accountBootstrap';
startPanelAccount();
const { active, primary, go, back } = useNavigation();
interface LeaveGuard {
  beforeLeave(): Promise<boolean>;
}
const contentScreen = ref<LeaveGuard | null>(null);
const moduleSaveError = ref('');
const modulesScreen = ref<LeaveGuard | null>(null);
const navigating = ref(false);
async function navigate(id?: ViewId) {
  if (navigating.value) return;
  navigating.value = true;
  try {
    if (active.value === 'v-content' && !(await contentScreen.value?.beforeLeave())) return;
    if (active.value === 'v-auto' && !(await modulesScreen.value?.beforeLeave())) return;
    if (id) go(id);
    else back();
    await nextTick();
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.querySelector<HTMLElement>('.body .view h1')?.focus();
  } finally {
    navigating.value = false;
  }
}
const { snapshot, history, pillars, total, isReal, refreshing, refreshError, refresh } = useSsi();
const { history: pvHistory, isReal: pvIsReal } = useProfileViews();
const { modules, toggle, setLimit, flush: flushModules } = useModules();
const {
  status: autopilotStatus,
  stage: autopilotStage,
  reports,
  startHint,
  pending: autopilotPending,
  start: startAutopilot,
  stop: stopAutopilot,
} = useAutopilot({ beforeStart: flushModules });

function toggleModule(id: Parameters<typeof toggle>[0]) {
  moduleSaveError.value = '';
  void toggle(id).catch(() => {
    moduleSaveError.value =
      'Не удалось сохранить модуль. Повторите изменение; запуск дождётся сохранения.';
  });
}

function setModuleLimit(id: Parameters<typeof setLimit>[0], value: number) {
  moduleSaveError.value = '';
  void setLimit(id, value).catch(() => {
    moduleSaveError.value =
      'Не удалось сохранить лимит. Повторите изменение; запуск дождётся сохранения.';
  });
}
</script>

<template>
  <div class="app">
    <TopBar :active="autopilotStatus?.running ?? false" @open-settings="navigate('v-settings')" />
    <main class="body">
      <div
        v-if="active === 'v-auto' || active === 'v-settings' || active === 'v-profile'"
        class="back-heading"
      >
        <button class="ghost" data-testid="back-view" @click="navigate()">Вернуться</button>
      </div>
      <KeepAlive>
        <ProfileAuditScreen v-if="active === 'v-profile'" @back="navigate()" />
        <InboxScreen
          v-else-if="active === 'v-inbox'"
          :pv-history="pvHistory"
          :pv-is-real="pvIsReal"
        />
        <DashScreen
          v-else-if="active === 'v-dash'"
          :snapshot="snapshot"
          :pillars="pillars"
          :total="total"
          :history="history"
          :pv-history="pvHistory"
          :pv-is-real="pvIsReal"
          :is-real="isReal"
          :refreshing="refreshing"
          :refresh-error="refreshError"
          :autopilot-running="autopilotStatus?.running ?? false"
          :autopilot-stage="autopilotStage"
          :start-hint="startHint"
          :autopilot-pending="autopilotPending"
          :enabled-module-ids="
            modules.filter((module) => module.enabled).map((module) => module.id)
          "
          @refresh="refresh"
          @start-autopilot="startAutopilot"
          @stop-autopilot="stopAutopilot"
          @open-audit="navigate('v-profile')"
          @open-modules="navigate('v-auto')"
          @open-settings="navigate('v-settings')"
          @open-inbox="navigate('v-inbox')"
        />
        <ModulesScreen
          v-else-if="active === 'v-auto'"
          ref="modulesScreen"
          :modules="modules"
          :save-error="moduleSaveError"
          @toggle="toggleModule"
          @set-limit="setModuleLimit"
        />
        <ReportsScreen v-else-if="active === 'v-reports'" :reports="reports" />
        <SettingsScreen v-else-if="active === 'v-settings'" />
        <ContentScreen v-else-if="active === 'v-content'" ref="contentScreen" />
      </KeepAlive>
    </main>
    <BottomNav :active="primary" @go="navigate" />
  </div>
</template>
