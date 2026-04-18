/** User-facing copy when Firestore fails (missing index, permission, network). */
export const DATA_LOAD_TOAST =
  "Something went wrong. Please try again.";

export async function runFirestoreQuery<T>(
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch {
    const err = new Error(DATA_LOAD_TOAST);
    err.name = "FirestoreQueryError";
    throw err;
  }
}
