import { useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { ApiError } from '../lib/api';
import type { ExplanationResponse } from '../lib/types';

const cache = new Map<string, ExplanationResponse>();

export default function PlainLanguage({
  cacheKey,
  intro,
  label,
  explain,
}: {
  cacheKey: string;
  intro: string;
  label: string;
  explain: () => Promise<ExplanationResponse>;
}) {
  const [explanation, setExplanation] = useState(() => cache.get(cacheKey));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const result = await explain();
      cache.set(cacheKey, result);
      setExplanation(result);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 503
          ? caught.message
          : 'Gemini could not explain this right now. Try again in a moment.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="plain-language" aria-label="Plain English">
      <h4>
        <Sparkles size={14} /> Plain English
      </h4>
      <p className="type-explanation">{intro}</p>
      {explanation ? (
        <>
          <p className="plain-summary">{explanation.summary}</p>
          {explanation.terms.length > 0 && (
            <dl className="jargon-list">
              {explanation.terms.map((item) => (
                <div key={item.term}>
                  <dt>{item.term}</dt>
                  <dd>{item.meaning}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="ai-note">Written by AI from the protocol text. Not medical advice.</p>
        </>
      ) : (
        <>
          <button className="secondary-button" onClick={() => void run()} disabled={loading}>
            {loading ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
            {loading ? 'Explaining…' : label}
          </button>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
