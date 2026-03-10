import { adoClient } from './client';

export interface AttachmentUploadResult {
  id: string;
  url: string;
}

/** Upload a file as an ADO attachment and return its download URL */
export async function uploadAttachment(file: File): Promise<AttachmentUploadResult> {
  return adoClient.postBinary<AttachmentUploadResult>(
    '/wit/attachments',
    file,
    { fileName: file.name },
  );
}
