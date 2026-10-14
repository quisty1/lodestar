// MV3 service worker: composition root. Launch, schedule, and message routing
// live in their own modules. RunCoordinator remains the only autopilot-state writer.

import { createAutopilotStart } from './autopilotStart';
import { registerServiceWorkerMessages } from './messageRouter';
import { registerWorkerRuntimes } from './registerWorkerRuntimes';
import { createModuleSteps } from './runModuleSteps';
import { createViewStep } from './runViewsStep';
import { registerScheduleAndAlarms } from './scheduleAndAlarms';
import { createWorkerContext } from './workerContext';

const worker = createWorkerContext();
const steps = createModuleSteps(worker);
const views = createViewStep({ ...worker, contentSleep: steps.contentSleep });
const startAutopilot = createAutopilotStart(worker, {
  runViewsThen: views.runViewsThen,
  runAcceptThen: steps.runAcceptThen,
  runConnectsThen: steps.runConnectsThen,
  publishApprovedThen: steps.publishApprovedThen,
});

registerWorkerRuntimes(worker, startAutopilot);
registerScheduleAndAlarms(worker, startAutopilot);
registerServiceWorkerMessages(worker);
