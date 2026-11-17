import type { DiscoverJobsResponse } from "../types/career.ts";

export interface DiscoverySearchUiState {
  isSearching: boolean;
  errorMessage: string | null;
  cancelledMessage: string | null;
  response: DiscoverJobsResponse | null;
  expandedJobIds: Record<string, boolean>;
}

export interface DiscoverySearchCallbacks {
  onStart: () => void;
  onCancel: () => void;
  onSuccess: (response: DiscoverJobsResponse) => void;
  onError: (message: string) => void;
}

export type DiscoveryRunOutcome<T> =
  | { status: "completed"; data: T }
  | { status: "cancelled" }
  | { status: "ignored" }
  | { status: "blocked_already_running" };

export const DISCOVERY_CANCELLED_MESSAGE = "Työpaikkahaku keskeytetty";

export class DiscoverySearchCoordinator<T = DiscoverJobsResponse> {
  private activeController: AbortController | null = null;
  private activeRequestId: number | null = null;
  private nextRequestId = 1;
  private cancelledRequestIds = new Set<number>();

  isRunning(): boolean {
    return this.activeController !== null && this.activeRequestId !== null;
  }

  isCurrentRequest(requestId: number): boolean {
    return (
      this.activeRequestId === requestId &&
      !this.cancelledRequestIds.has(requestId) &&
      this.activeController !== null &&
      !this.activeController.signal.aborted
    );
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
    executor: (signal: AbortSignal, requestId: number) => Promise<T>,
    handlers?: {
      onStart?: (requestId: number) => void;
      onSuccess?: (data: T, requestId: number) => void;
      onError?: (error: unknown, requestId: number) => void;
    }
  ): Promise<DiscoveryRunOutcome<T>> {
    if (this.activeController !== null) {
      return { status: "blocked_already_running" };
    }

    const requestId = this.nextRequestId++;
    const controller = new AbortController();
    this.activeController = controller;
    this.activeRequestId = requestId;

    handlers?.onStart?.(requestId);

    try {
      const data = await executor(controller.signal, requestId);

      if (
        controller.signal.aborted ||
        this.cancelledRequestIds.has(requestId) ||
        this.activeRequestId !== requestId ||
        this.activeController !== controller
      ) {
        return { status: "ignored" };
      }

      this.activeController = null;
      this.activeRequestId = null;
      handlers?.onSuccess?.(data, requestId);
      return { status: "completed", data };
    } catch (error) {
      const wasCancelledOrSuperseded =
        controller.signal.aborted ||
        this.cancelledRequestIds.has(requestId) ||
        this.activeRequestId !== requestId ||
        this.activeController !== controller ||
        (error instanceof Error && error.name === "AbortError");

      if (this.activeRequestId === requestId && this.activeController === controller) {
        this.activeController = null;
        this.activeRequestId = null;
      }

      if (wasCancelledOrSuperseded) {
        return { status: "cancelled" };
      }

      handlers?.onError?.(error, requestId);
      return { status: "ignored" };
    }
  }
}

export function createDiscoverySearchSession(callbacks: DiscoverySearchCallbacks) {
  const coordinator = new DiscoverySearchCoordinator<DiscoverJobsResponse>();

  return {
    isRunning(): boolean {
      return coordinator.isRunning();
    },

    cancel(): boolean {
      const didCancel = coordinator.cancel();
      if (didCancel) {
        callbacks.onCancel();
      }
      return didCancel;
    },

    async execute(
      fetcher: (signal: AbortSignal) => Promise<DiscoverJobsResponse>
    ): Promise<DiscoveryRunOutcome<DiscoverJobsResponse>> {
      return coordinator.run(
        (signal) => fetcher(signal),
        {
          onStart: () => {
            callbacks.onStart();
          },
          onSuccess: (data) => {
            callbacks.onSuccess(data);
          },
          onError: (err) => {
            const message =
              err instanceof Error
                ? err.message
                : "Verkkovirhe työpaikkojen haun aikana.";
            callbacks.onError(message);
          },
        }
      );
    },
  };
}

export function createInitialDiscoveryUiState(): DiscoverySearchUiState {
  return {
    isSearching: false,
    errorMessage: null,
    cancelledMessage: null,
    response: null,
    expandedJobIds: {},
  };
}
