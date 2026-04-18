import { ref, uploadBytes } from "firebase/storage";
import type { FirebaseStorage } from "firebase/storage";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Stores proof at paymentProofs/{bookingId}.jpg or .png (overwrites prior).
 * Returns the Storage object path for Firestore. Guests cannot call getDownloadURL
 * when read is auth only; the admin client resolves the path to a URL after sign in.
 */
export async function uploadPaymentProofImage(
  storage: FirebaseStorage,
  bookingId: string,
  file: File
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are allowed.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Image must be under 5 MB.");
  }
  const ext = file.type === "image/png" ? "png" : "jpg";
  const path =
    ext === "png"
      ? `paymentProofs/${bookingId}.png`
      : `paymentProofs/${bookingId}.jpg`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: file.type });
  return path;
}
