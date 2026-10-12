/**
 * Cross-platform image utilities for LIAN.
 *
 * The core problem: converting a local image URI to base64 is completely
 * different on native vs web:
 *
 * Native (Hermes):
 *   - fetch() cannot read local file:// or content:// URIs
 *   - FileReader doesn't exist
 *   - expo-file-system readAsStringAsync works reliably
 *
 * Web:
 *   - expo-file-system is not available
 *   - fetch() can read blob: URLs from the image picker
 *   - FileReader works fine
 */
import { Platform } from 'react-native';

/**
 * Convert an image URI (file://, content://, blob:, or data:) to a
 * base64-encoded string (without the data: prefix).
 *
 * Works on both native (Hermes) and web.
 */
export async function imageUriToBase64(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    return imageUriToBase64Web(uri);
  }
  return imageUriToBase64Native(uri);
}

async function imageUriToBase64Web(uri: string): Promise<string> {
  // On web the image picker returns a blob: URI that fetch() can read
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // Strip "data:image/jpeg;base64," prefix
      const base64 = dataUrl.split(',')[1];
      if (!base64) reject(new Error('Failed to read image as base64'));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

async function imageUriToBase64Native(uri: string): Promise<string> {
  // Dynamic import so web bundle doesn't include native modules
  const FileSystem = await import('expo-file-system');
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64;
}

/**
 * Upload an image URI directly to Supabase Storage.
 * Returns the storage path.
 *
 * On native: reads file bytes with expo-file-system and uploads as ArrayBuffer.
 * On web: fetches the blob URI and uploads as Blob.
 */
export async function uploadImageToSupabase(
  uri: string,
  bucketName: string,
  filePath: string,
  supabaseClient: import('@supabase/supabase-js').SupabaseClient,
): Promise<{ path: string; signedUrl: string }> {
  let uploadError: Error | null = null;

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    const { error } = await supabaseClient.storage
      .from(bucketName)
      .upload(filePath, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) uploadError = error;
  } else {
    const FileSystem = await import('expo-file-system');
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // Convert base64 to Uint8Array for upload
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const { error } = await supabaseClient.storage
      .from(bucketName)
      .upload(filePath, bytes, { contentType: 'image/jpeg', upsert: false });
    if (error) uploadError = error;
  }

  if (uploadError) throw uploadError;

  // Our buckets are private — generate a signed URL valid for 10 years
  const { data: signedData, error: signedError } = await supabaseClient.storage
    .from(bucketName)
    .createSignedUrl(filePath, 60 * 60 * 24 * 365 * 10);

  if (signedError || !signedData) {
    throw signedError ?? new Error('Failed to create signed URL');
  }

  return { path: filePath, signedUrl: signedData.signedUrl };
}
