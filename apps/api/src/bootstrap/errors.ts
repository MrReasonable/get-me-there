/** The one boot-refusal error (plan decision 58): the app bootstrap and the lock wait throw it; start.ts exits with its code. */
export class BootError extends Error {
  /** The plan's single exit-code table (`EXIT`): 70, 73, 74, 75, 78; 1 for anything else. */
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'BootError';
    this.exitCode = exitCode;
  }
}
