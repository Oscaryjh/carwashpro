ALTER TABLE "notification_queue"
ADD COLUMN "document_base64" TEXT,
ADD COLUMN "document_mime_type" TEXT,
ADD COLUMN "document_file_name" TEXT;
