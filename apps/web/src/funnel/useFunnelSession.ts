import { useEffect, useState, useSyncExternalStore } from 'react';
import { FunnelController, type FunnelState } from './session/controller';

/**
 * Binds the FunnelController (session lifecycle, navigation, persistence, analytics) to React.
 * The controller is created once per mount; start/stop are idempotent so StrictMode is safe.
 */
export function useFunnelSession(): { state: FunnelState; controller: FunnelController } {
  const [controller] = useState(() => new FunnelController());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  return { state, controller };
}
