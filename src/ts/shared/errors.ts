namespace SharedErrors {
  const BENIGN_ANALYSIS_ERROR_FRAGMENTS = [
    "Analysis superseded",
    "message channel closed",
    "Receiving end does not exist",
    "Could not establish connection",
    "Extension context invalidated",
  ];
  const MISSING_RECEIVER_ERROR_FRAGMENTS = [
    "Receiving end does not exist",
    "Could not establish connection",
    "message channel closed",
    "Extension context invalidated",
  ];

  function getMessage(value: unknown): string {
    if (value instanceof Error) {
      return value.message;
    }

    return String(value ?? "");
  }

  function includesAnyFragment(value: unknown, fragments: string[]): boolean {
    const message = getMessage(value);
    return fragments.some((fragment) => message.includes(fragment));
  }

  export function getErrorMessage(error: unknown): string {
    return getMessage(error);
  }

  export function isBenignAnalysisError(error: unknown): boolean {
    return includesAnyFragment(error, BENIGN_ANALYSIS_ERROR_FRAGMENTS);
  }

  export function isMissingReceiverError(error: unknown): boolean {
    return includesAnyFragment(error, MISSING_RECEIVER_ERROR_FRAGMENTS);
  }
}
