import { ArrowRight, CircleAlert, FileText, LoaderCircle, RotateCw, Upload } from 'lucide-react';
import { formatDate } from '../lib/api';
import type { AnalysisSummary } from '../lib/types';

export default function HistoryPanel({
  analyses,
  loading,
  error,
  currentId,
  onOpen,
  onRetry,
  onUpload,
}: {
  analyses: AnalysisSummary[];
  loading: boolean;
  error: string | null;
  currentId: string | null;
  onOpen: (analysisId: string) => void;
  onRetry: () => void;
  onUpload: () => void;
}) {
  return (
    <section className="history-panel" aria-label="Analysis history">
      <div className="section-heading">
        <h2>
          Analyzed protocols <span className="count">{analyses.length}</span>
        </h2>
        <button className="text-button" onClick={onRetry} disabled={loading}>
          <RotateCw size={13} /> Refresh
        </button>
      </div>
      {error ? (
        <div className="empty-state error">
          <CircleAlert size={20} />
          <div>
            <strong>Could not load history</strong>
            <p>{error}</p>
            <button className="text-button" onClick={onRetry}>
              Try again
            </button>
          </div>
        </div>
      ) : loading && !analyses.length ? (
        <p className="muted loading-line" role="status">
          <LoaderCircle size={15} className="spin" /> Loading history…
        </p>
      ) : !analyses.length ? (
        <div className="empty-state">
          <FileText size={20} />
          <div>
            <strong>No protocols analyzed yet</strong>
            <p>Uploaded protocols appear here so you can reopen them later.</p>
            <button className="text-button" onClick={onUpload}>
              <Upload size={13} /> Upload a protocol
            </button>
          </div>
        </div>
      ) : (
        analyses.map((item) => (
          <button
            className={`history-row ${item.analysis_id === currentId ? 'current' : ''}`}
            key={item.analysis_id}
            aria-current={item.analysis_id === currentId ? 'true' : undefined}
            onClick={() => onOpen(item.analysis_id)}
          >
            <FileText size={19} />
            <span>
              <strong>{item.filename}</strong>
              <small>
                Analyzed {formatDate(item.created_at)}
                {item.analysis_id === currentId ? ' · Currently open' : ''}
              </small>
            </span>
            <ArrowRight size={16} />
          </button>
        ))
      )}
    </section>
  );
}
