export type CloudinaryResourceType = 'image' | 'video' | 'raw';

export interface BufferedUploadFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface UploadedAsset {
  publicId: string;
  secureUrl: string;
  url: string;
  resourceType: string;
  format?: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  folder: string;
  originalFileName: string;
  mimeType: string;
  createdAt?: string;
}

export interface UploadSuccessResponse {
  success: true;
  data: UploadedAsset;
  message: string;
}

export interface UploadBatchSuccessResponse {
  success: true;
  data: UploadedAsset[];
  message: string;
}

export interface DeleteUploadSuccessResponse {
  success: true;
  data: {
    publicId: string;
    resourceType: string;
    result: string;
  };
  message: string;
}

export interface ConversationAttachmentReference {
  publicId: string;
  secureUrl: string;
  resourceType: CloudinaryResourceType;
  bytes: number;
  originalFileName: string;
  mimeType: string;
  format?: string;
}

export interface CloudinaryResourceResult {
  public_id: string;
  secure_url: string;
  resource_type: string;
  format?: string;
  bytes: number;
  original_filename?: string;
  context?: { custom?: Record<string, string> };
}

export interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
  url: string;
  resource_type: string;
  format?: string;
  bytes: number;
  width?: number;
  height?: number;
  duration?: number;
  created_at?: string;
}

export interface CloudinaryClient {
  config(options: {
    cloud_name: string;
    api_key: string;
    api_secret: string;
    secure: boolean;
  }): unknown;
  api: {
    resource(
      publicId: string,
      options: { resource_type: CloudinaryResourceType },
    ): Promise<CloudinaryResourceResult>;
  };
  uploader: {
    upload_stream(
      options: {
        asset_folder: string;
        public_id: string;
        resource_type: CloudinaryResourceType;
        use_filename: boolean;
        unique_filename: boolean;
        overwrite: boolean;
        tags: string[];
        context: Record<string, string>;
      },
      callback: (
        error: { message?: string } | undefined,
        response: CloudinaryUploadResult | undefined,
      ) => void,
    ): { end(buffer: Buffer): void };
    destroy(
      publicId: string,
      options: { resource_type: CloudinaryResourceType; invalidate: boolean },
    ): Promise<{ result?: string }>;
  };
}
