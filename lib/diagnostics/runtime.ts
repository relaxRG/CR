import { appendDiagnosticLog } from "@/lib/sync/engine";

type ErrorUtilsLike = {
  getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
  setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
};

type GlobalEventTargetLike = typeof globalThis & {
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
  ErrorUtils?: ErrorUtilsLike;
};

const MAX_DIAGNOSTIC_TEXT_LENGTH = 12_000;

const REDACTION_PATTERNS: RegExp[] = [
  /(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
  /((?:token|password|secret|api[_-]?key)\s*[:=]\s*["']?)[^,\s"'&]+/gi,
  /([?&](?:token|password|secret|api[_-]?key)=)[^&\s]+/gi,
];

function sanitizeDiagnosticText(value: string): string {
  const redacted = REDACTION_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, "$1[REDACTED]"),
    value,
  );
  return redacted.length > MAX_DIAGNOSTIC_TEXT_LENGTH
    ? `${redacted.slice(0, MAX_DIAGNOSTIC_TEXT_LENGTH)}\n[TRUNCATED]`
    : redacted;
}

function describeUnknownError(error: unknown): { message: string; detail?: string } {
  if (error instanceof Error) {
    const message = `${error.name}: ${error.message || "Unknown error"}`;
    return {
      message: sanitizeDiagnosticText(message),
      detail: error.stack ? sanitizeDiagnosticText(error.stack) : undefined,
    };
  }
  if (typeof error === "string") {
    return { message: sanitizeDiagnosticText(error) };
  }
  try {
    return { message: sanitizeDiagnosticText(JSON.stringify(error)) };
  } catch {
    return { message: "Non-serializable runtime error" };
  }
}

/**
 * Logs only diagnostic metadata and stack text. It intentionally excludes AsyncStorage values,
 * request bodies and user content so an exported log can be shared for crash investigation.
 */
export async function recordRuntimeEvent(source: string, message: string, detail?: string): Promise<void> {
  try {
    await appendDiagnosticLog({
      source,
      message: sanitizeDiagnosticText(message),
      detail: detail ? sanitizeDiagnosticText(detail) : undefined,
    });
  } catch (diagnosticWriteError) {
    // Diagnostics must never become a new crash source. The original application error is not
    // swallowed: this fallback only reports a failure to persist its supporting evidence.
    console.warn("[RuntimeDiagnostics] Failed to persist diagnostic event", diagnosticWriteError);
  }
}

export async function recordRuntimeError(
  source: string,
  error: unknown,
  componentStack?: string,
): Promise<void> {
  const description = describeUnknownError(error);
  const detail = [description.detail, componentStack ? sanitizeDiagnosticText(componentStack) : undefined]
    .filter((value): value is string => Boolean(value))
    .join("\n\nComponent stack:\n");

  console.error("[RuntimeDiagnostics]", source, description.message, detail || undefined);
  await recordRuntimeEvent(source, description.message, detail || undefined);
}

/**
 * Installs a passive observer around React Native's existing global error handler. The previous
 * handler is always invoked afterwards; therefore fatal exceptions retain their native behavior
 * and are never hidden behind a retry loop or a generic recovery screen.
 */
export function installGlobalRuntimeDiagnostics(): () => void {
  const runtime = globalThis as GlobalEventTargetLike;
  const errorUtils = runtime.ErrorUtils;
  const previousHandler = errorUtils?.getGlobalHandler?.();
  let installedHandler: ((error: Error, isFatal?: boolean) => void) | undefined;

  if (errorUtils?.setGlobalHandler && previousHandler) {
    installedHandler = (error, isFatal) => {
      void recordRuntimeError(isFatal ? "global_js_fatal" : "global_js_nonfatal", error);
      previousHandler(error, isFatal);
    };
    errorUtils.setGlobalHandler(installedHandler);
  }

  const unhandledRejectionListener = (event: unknown) => {
    const reason = typeof event === "object" && event !== null && "reason" in event
      ? (event as { reason?: unknown }).reason
      : event;
    void recordRuntimeError("unhandled_promise_rejection", reason);
  };
  runtime.addEventListener?.("unhandledrejection", unhandledRejectionListener);

  return () => {
    runtime.removeEventListener?.("unhandledrejection", unhandledRejectionListener);
    if (installedHandler && errorUtils?.getGlobalHandler?.() === installedHandler) {
      errorUtils.setGlobalHandler?.(previousHandler!);
    }
  };
}

/** Redacts high-entropy dynamic route segments before they enter shareable diagnostics. */
export function redactRuntimePath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => (/^[0-9a-f]{8}-[0-9a-f-]{16,}$/i.test(segment) || /^[0-9]{5,}$/.test(segment) ? ":id" : segment))
    .join("/");
}
