export class OfflineError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "OfflineError";
  }
}

export class QuotaExceededError extends OfflineError {
  constructor(
    message: string = "Storage quota exceeded",
    public readonly requiredBytes?: number,
    public readonly availableBytes?: number
  ) {
    super(message, "QUOTA_EXCEEDED");
    this.name = "QuotaExceededError";
  }
}

export class CapabilityError extends OfflineError {
  constructor(
    message: string,
    public readonly capability: string
  ) {
    super(message, "CAPABILITY_UNSUPPORTED");
    this.name = "CapabilityError";
  }
}

export class RangeNotSatisfiableError extends OfflineError {
  constructor(
    message: string = "Requested range not satisfiable",
    public readonly requestedRange?: string,
    public readonly totalBytes?: number
  ) {
    super(message, "RANGE_NOT_SATISFIABLE");
    this.name = "RangeNotSatisfiableError";
  }
}

export class StorageUnavailableError extends OfflineError {
  constructor(
    message: string = "Offline storage is not available in this environment"
  ) {
    super(message, "STORAGE_UNAVAILABLE");
    this.name = "StorageUnavailableError";
  }
}

export class DownloadAbortedError extends OfflineError {
  constructor(message: string = "Download was aborted") {
    super(message, "DOWNLOAD_ABORTED");
    this.name = "DownloadAbortedError";
  }
}
