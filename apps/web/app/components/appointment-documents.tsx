"use client";

import { useCallback, useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type AppointmentDocument = {
  id: string;
  filename: string;
  mediaType: string;
  byteSize: number;
  uploaderName: string;
  uploadedAt: string;
  canDelete: boolean;
};

async function readResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? "Document request failed.");
  return body.data;
}

export function AppointmentDocuments({ appointmentId }: { appointmentId: string }) {
  const [documents, setDocuments] = useState<AppointmentDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await readResponse(await fetch(`${apiUrl}/api/v1/appointments/${appointmentId}/documents`, { credentials: "include" }));
      setDocuments(data.documents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Documents could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [appointmentId]);

  useEffect(() => { void loadDocuments(); }, [loadDocuments]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      await readResponse(await fetch(`${apiUrl}/api/v1/appointments/${appointmentId}/documents`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": file.type,
          "x-file-name": encodeURIComponent(file.name)
        },
        body: file
      }));
      setNotice("Document uploaded securely to private appointment storage.");
      await loadDocuments();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(documentId: string) {
    setError("");
    setNotice("");
    try {
      await readResponse(await fetch(`${apiUrl}/api/v1/appointments/${appointmentId}/documents/${documentId}`, {
        method: "DELETE",
        credentials: "include"
      }));
      setNotice("Document removed.");
      await loadDocuments();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document could not be removed.");
    }
  }

  return <section className="appointment-documents" aria-label="Appointment documents">
    <h3>Shared documents</h3>
    <p>PDF, JPEG, or PNG within the configured upload limit. Only the patient and assigned doctor can access these files.</p>
    <label>Upload a document<input
      type="file"
      accept="application/pdf,image/jpeg,image/png"
      disabled={uploading}
      onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }}
    /></label>
    {uploading && <p role="status">Uploading document…</p>}
    {loading ? <p role="status">Loading shared documents…</p> : documents.length === 0
      ? <p className="form-help">No documents have been shared for this appointment.</p>
      : <ul>{documents.map((document) => <li key={document.id}>
        <div><strong>{document.filename}</strong><span>{Math.ceil(document.byteSize / 1024)} KB · {document.uploaderName}</span><time dateTime={document.uploadedAt}>{new Date(document.uploadedAt).toLocaleString()}</time></div>
        <a href={`${apiUrl}/api/v1/appointments/${appointmentId}/documents/${document.id}`}>Download</a>
        {document.canDelete && <button type="button" className="text-button" onClick={() => void remove(document.id)}>Remove</button>}
      </li>)}</ul>}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    {notice && <p role="status" className="notice notice-success">{notice}</p>}
  </section>;
}
