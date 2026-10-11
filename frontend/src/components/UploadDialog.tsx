import { useEffect, useRef, useState } from 'react';
import { FileText, LoaderCircle, Upload, X } from 'lucide-react';
import { MAX_PDF_BYTES, analyzeProtocol, uploadErrorMessage } from '../lib/api';
import type { AnalysisResponse } from '../lib/types';

function formatElapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function validate(file: File): string | null {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 'Choose a PDF file.';
  if (file.size > MAX_PDF_BYTES) return 'The PDF is larger than the 20 MB limit.';
  if (file.size === 0) return 'The selected file is empty.';
  return null;
}

export default function UploadDialog({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (analysis: AnalysisResponse) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const uploading = startedAt !== null;

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  useEffect(() => () => controller.current?.abort(), []);

  function reset() {
    controller.current?.abort();
    controller.current = null;
    setFile(null);
    setError(null);
    setStartedAt(null);
    setElapsed(0);
  }

  function close() {
    reset();
    onClose();
  }

  function choose(next: File | undefined) {
    setFile(next ?? null);
    setError(next ? validate(next) : null);
  }

  async function submit() {
    if (!file || validate(file)) return;
    const current = new AbortController();
    controller.current = current;
    setError(null);
    setElapsed(0);
    setStartedAt(Date.now());
    try {
      const analysis = await analyzeProtocol(file, current.signal);
      if (current.signal.aborted) return;
      reset();
      onUploaded(analysis);
    } catch (caught) {
      if (current.signal.aborted) return;
      controller.current = null;
      setStartedAt(null);
      setError(uploadErrorMessage(caught));
    }
  }

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setStartedAt(null);
    setError('Upload cancelled.');
  }

  return (
    <dialog
      ref={dialog}
      onCancel={close}
      onClose={() => open && close()}
      aria-labelledby="upload-title"
    >
      <div className="modal">
        <button
          className="icon-button modal-close"
          aria-label="Close upload dialog"
          onClick={close}
        >
          <X size={18} />
        </button>
        <Upload className="upload-symbol" size={25} />
        <h2 id="upload-title">Upload a protocol</h2>
        <p>
          Choose a text-based clinical trial protocol PDF (up to 20 MB). Gemini extracts its
          concepts and relationships, then the graph is checked and saved to history.
        </p>
        <label className={`file-picker ${uploading ? 'disabled' : ''}`}>
          <FileText size={17} />
          <span>{file ? file.name : 'Choose PDF…'}</span>
          <input
            type="file"
            accept=".pdf,application/pdf"
            aria-label="Protocol PDF"
            disabled={uploading}
            onChange={(event) => choose(event.target.files?.[0])}
          />
        </label>
        {uploading && (
          <p className="upload-progress" role="status">
            <LoaderCircle size={15} className="spin" />
            Extracting the protocol with Gemini, usually 1-2 minutes · {formatElapsed(elapsed)}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {uploading ? (
          <button className="secondary-button modal-action" onClick={cancel}>
            Cancel
          </button>
        ) : (
          <button
            className="primary-button modal-action"
            disabled={!file || Boolean(validate(file))}
            onClick={() => void submit()}
          >
            <Upload size={15} /> Analyze protocol
          </button>
        )}
      </div>
    </dialog>
  );
}
