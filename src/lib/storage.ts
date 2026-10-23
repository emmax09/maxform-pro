export type StoragePurpose =
  | "workspace_file"
  | "form_response"
  | "form_asset"
  | "event_asset"
  | "ticket_asset"
  | "email_image"
  | "profile_avatar"
  | "product_image"
  | "crm_attachment"
  | "document_template"
  | "generated_document"
  | "export";

export type StoredObject = {
  id: string;
  provider: "r2";
  objectKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string | null;
  visibility: "private" | "public";
  etag?: string;
  checksumSha256?: string;
  scanStatus?: "pending" | "validated" | "quarantined";
};

type UploadIntent = {
  object: StoredObject;
  completionToken: string;
  upload:
    | {
        mode: "single";
        uploadUrl: string;
        expiresInSeconds: number;
      }
    | {
        mode: "multipart";
        uploadId: string;
        partSize: number;
        expiresInSeconds: number;
      };
};

type StorageRequestOptions = {
  authenticated?: boolean;
  signal?: AbortSignal;
};

const accessToken = () =>
  typeof localStorage === "undefined"
    ? ""
    : localStorage.getItem("access_token") || "";

const storageRequest = async <T>(
  action: string,
  body: Record<string, unknown>,
  options: StorageRequestOptions = {},
) => {
  const token = accessToken();
  if (options.authenticated === true && !token) {
    throw new Error("Sign in before uploading a file.");
  }
  const response = await fetch(
    `/api/storage?action=${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: options.signal,
    },
  );
  const value = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(value.error || "The storage request failed.");
  }
  return value;
};

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const uploadPart = (
  url: string,
  body: Blob,
  input: {
    contentType?: string;
    signal?: AbortSignal;
    onProgress?: (loaded: number) => void;
  },
) =>
  new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    if (input.contentType) {
      request.setRequestHeader("Content-Type", input.contentType);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress?.(event.loaded);
    };
    request.onerror = () =>
      reject(new Error("The file could not reach object storage."));
    request.onabort = () =>
      reject(new DOMException("The upload was cancelled.", "AbortError"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        input.onProgress?.(body.size);
        resolve(request.getResponseHeader("ETag") || "");
      } else {
        reject(
          new Error(
            request.status === 403
              ? "The secure upload URL expired. Upload the file again."
              : "Object storage rejected the upload.",
          ),
        );
      }
    };
    const abort = () => request.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    request.onloadend = () =>
      input.signal?.removeEventListener("abort", abort);
    request.send(body);
  });

const uploadWithRetry = async (
  url: string,
  body: Blob,
  input: {
    contentType?: string;
    signal?: AbortSignal;
    onProgress?: (loaded: number) => void;
  },
) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await uploadPart(url, body, input);
    } catch (error) {
      lastError = error;
      if (
        input.signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError") ||
        attempt === 3
      ) {
        throw error;
      }
      await wait(250 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
};

const runWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
) => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await task(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

export type StorageUploadOptions = {
  purpose: StoragePurpose;
  visibility?: "private" | "public";
  sourceId?: string | null;
  formId?: string;
  fieldId?: string;
  fileName?: string;
  authenticated?: boolean;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
};

export async function uploadFileToStorage(
  file: Blob | File,
  options: StorageUploadOptions,
) {
  const fileName =
    options.fileName ||
    (typeof File !== "undefined" && file instanceof File
      ? file.name
      : "upload");
  const mimeType = file.type || "application/octet-stream";
  const intent = await storageRequest<UploadIntent>(
    "intent",
    {
      purpose: options.purpose,
      visibility: options.visibility,
      sourceId: options.sourceId || null,
      formId: options.formId,
      fieldId: options.fieldId,
      fileName,
      mimeType,
      sizeBytes: file.size,
    },
    {
      authenticated:
        options.authenticated ?? options.purpose !== "form_response",
      signal: options.signal,
    },
  );

  try {
    if (intent.upload.mode === "single") {
      await uploadWithRetry(intent.upload.uploadUrl, file, {
        contentType: mimeType,
        signal: options.signal,
        onProgress: (loaded) =>
          options.onProgress?.(
            Math.min(99, Math.round((loaded / file.size) * 100)),
          ),
      });
      const completed = await storageRequest<{ object: StoredObject }>(
        "complete",
        { completionToken: intent.completionToken },
        { signal: options.signal },
      );
      options.onProgress?.(100);
      return completed.object;
    }

    const partSize = intent.upload.partSize;
    const parts = Array.from(
      { length: Math.ceil(file.size / partSize) },
      (_, index) => ({
        partNumber: index + 1,
        start: index * partSize,
        end: Math.min(file.size, (index + 1) * partSize),
      }),
    );
    const signedParts: Array<{ partNumber: number; url: string }> = [];
    for (let index = 0; index < parts.length; index += 100) {
      const batch = parts.slice(index, index + 100);
      const response = await storageRequest<{
        parts: Array<{ partNumber: number; url: string }>;
      }>(
        "parts",
        {
          completionToken: intent.completionToken,
          partNumbers: batch.map((part) => part.partNumber),
        },
        { signal: options.signal },
      );
      signedParts.push(...response.parts);
    }
    const urls = new Map(
      signedParts.map((part) => [part.partNumber, part.url]),
    );
    const loadedByPart = new Map<number, number>();
    const completedParts = await runWithConcurrency(
      parts,
      4,
      async (part) => {
        const url = urls.get(part.partNumber);
        if (!url) throw new Error("An upload part URL is missing.");
        const etag = await uploadWithRetry(
          url,
          file.slice(part.start, part.end),
          {
            signal: options.signal,
            onProgress: (loaded) => {
              loadedByPart.set(part.partNumber, loaded);
              const totalLoaded = Array.from(loadedByPart.values()).reduce(
                (sum, value) => sum + value,
                0,
              );
              options.onProgress?.(
                Math.min(99, Math.round((totalLoaded / file.size) * 100)),
              );
            },
          },
        );
        return { partNumber: part.partNumber, etag };
      },
    );
    const completed = await storageRequest<{ object: StoredObject }>(
      "complete",
      {
        completionToken: intent.completionToken,
        parts: completedParts,
      },
      { signal: options.signal },
    );
    options.onProgress?.(100);
    return completed.object;
  } catch (error) {
    await storageRequest(
      "abort",
      { completionToken: intent.completionToken },
      { signal: undefined },
    ).catch(() => undefined);
    throw error;
  }
}

export const dataUrlToBlob = (dataUrl: string) => {
  const match = dataUrl.match(
    /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i,
  );
  if (!match) throw new Error("The selected file data is invalid.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1].toLowerCase() });
};

export const uploadDataUrlToStorage = (
  dataUrl: string,
  options: StorageUploadOptions,
) => uploadFileToStorage(dataUrlToBlob(dataUrl), options);

export const getStoredObjectAccess = (
  objectId: string,
  disposition: "inline" | "attachment" = "inline",
) =>
  storageRequest<{ object: StoredObject; url: string }>(
    "access",
    { objectId, disposition },
    { authenticated: true },
  );

export const getStoredObjectAccessBatch = async (objectIds: string[]) => {
  const uniqueIds = Array.from(new Set(objectIds.filter(Boolean)));
  const results: Array<{ object: StoredObject; url: string }> = [];
  for (let index = 0; index < uniqueIds.length; index += 100) {
    const response = await storageRequest<{
      objects: Array<{ object: StoredObject; url: string }>;
    }>(
      "access-batch",
      { objectIds: uniqueIds.slice(index, index + 100) },
      { authenticated: true },
    );
    results.push(...response.objects);
  }
  return results;
};

export const deleteStoredObject = (objectId: string) =>
  storageRequest<{ deleted: true }>(
    "delete",
    { objectId },
    { authenticated: true },
  );
