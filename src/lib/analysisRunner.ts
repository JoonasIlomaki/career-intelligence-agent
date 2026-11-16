export type AnalysisOutcome<T> =
  | { status: "completed"; data: T }
  | { status: "cancelled" }
  | { status: "ignored" };

export class SimultaneousAnalysisError extends Error {
  constructor() {
    super("Analyysi on jo käynnissä. Keskeytä nykyinen analyysi ennen uuden aloittamista.");
  }
}

export class AnalysisRequestCoordinator<T> {
  private activeController: AbortController | null = null;
  private activeRequestId: number | null = null;
  private nextRequestId = 1;
  private cancelledRequestIds = new Set<number>();

  isRunning(): boolean {
    return this.activeController !== null;
  }

  cancel(): boolean {
    if (!this.activeController || this.activeRequestId === null) {
      return false;
    }

    const requestIdToCancel = this.activeRequestId;
    const controllerToAbort = this.activeController;

    this.cancelledRequestIds.add(requestIdToCancel);
    this.activeController = null;
    this.activeRequestId = null;

    controllerToAbort.abort();
    return true;
  }

  async run(
    executor: (signal: AbortSignal) => Promise<T>
  ): Promise<AnalysisOutcome<T>> {
    if (this.activeController !== null) {
      throw new SimultaneousAnalysisError();
    }

    const requestId = this.nextRequestId++;
    const controller = new AbortController();
    this.activeController = controller;
    this.activeRequestId = requestId;

    try {
      const data = await executor(controller.signal);

      if (
        controller.signal.aborted ||
        this.cancelledRequestIds.has(requestId) ||
        this.activeRequestId !== requestId
      ) {
        return { status: "ignored" };
      }

      this.activeController = null;
      this.activeRequestId = null;
      return { status: "completed", data };
    } catch (error) {
      const wasCancelled =
        controller.signal.aborted ||
        this.cancelledRequestIds.has(requestId) ||
        (error instanceof Error && error.name === "AbortError");

      if (this.activeRequestId === requestId) {
        this.activeController = null;
        this.activeRequestId = null;
      }

      if (wasCancelled) {
        return { status: "cancelled" };
      }

      throw error;
    }
  }
}
