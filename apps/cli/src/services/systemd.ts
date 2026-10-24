import type { Paths, ServiceManager } from '../platform/types.js';

const notYet = (): never => {
  throw new Error('systemd service manager: Task 16b.3');
};
export function systemdManager(_uid: number, _paths: Paths): ServiceManager {
  return {
    render: notYet,
    facts: notYet,
    install: notYet,
    start: notYet,
    stop: notYet,
    restart: notYet,
    remove: notYet,
  };
}
