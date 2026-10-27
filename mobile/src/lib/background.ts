import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { autoCallLogAvailable, syncCalls } from "./callsync";
import { checkAlerts } from "./alerts";

export const CALL_SYNC_TASK = "relive-call-sync";

// Defined at module scope, as the task manager requires. Android runs it about every 15 minutes at best.
// Also shows new alerts (new leads, reminders) that arrived while the app was closed.
TaskManager.defineTask(CALL_SYNC_TASK, async () => {
  let ok = true;
  if (autoCallLogAvailable) { try { await syncCalls({ recordings: true }); } catch { ok = false; } }
  try { await checkAlerts(); } catch { ok = false; }
  return ok ? BackgroundTask.BackgroundTaskResult.Success : BackgroundTask.BackgroundTaskResult.Failed;
});

export async function ensureBackgroundSync() {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (!(await TaskManager.isTaskRegisteredAsync(CALL_SYNC_TASK))) await BackgroundTask.registerTaskAsync(CALL_SYNC_TASK, { minimumInterval: 15 });
  } catch {}
}
