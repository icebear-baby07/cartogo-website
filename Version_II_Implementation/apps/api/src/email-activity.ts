export type EmailActivityType =
  | "email_verification"
  | "inquiry_confirmation"
  | "inquiry_rejection"
  | "owner_approval";

export type EmailActivityAction = "queued" | "attempted" | "sent" | "failed";
export type EmailActivityRecorder = (
  type: EmailActivityType,
  action: EmailActivityAction,
) => Promise<void>;

async function recordSafely(
  recorder: EmailActivityRecorder | undefined,
  type: EmailActivityType,
  action: EmailActivityAction,
): Promise<void> {
  if (!recorder) return;
  try {
    await recorder(type, action);
  } catch (error) {
    console.error("Could not record email activity.", {
      type,
      action,
      name: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export async function recordEmailActivitySafely(
  recorder: EmailActivityRecorder | undefined,
  type: EmailActivityType,
  action: EmailActivityAction,
): Promise<void> {
  await recordSafely(recorder, type, action);
}

export async function withEmailActivity<T>(
  recorder: EmailActivityRecorder | undefined,
  type: EmailActivityType,
  send: () => Promise<T>,
): Promise<T> {
  await recordSafely(recorder, type, "attempted");
  try {
    const result = await send();
    await recordSafely(recorder, type, "sent");
    return result;
  } catch (error) {
    await recordSafely(recorder, type, "failed");
    throw error;
  }
}
