import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dbGetOwnRating, dbSaveOwnRating } from '../../services/supabaseClient';

// Tarjeta de calificación del portal: 1-5 estrellas + recomendación libre.
// Siempre visible; el cliente puede cambiar su voto cuando quiera (se sobreescribe).
export default function RatingCard({ client }) {
  const { t } = useTranslation();
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await dbGetOwnRating(client.id);
      if (!alive) return;
      if (r) { setStars(r.stars || 0); setComment(r.comment || ''); setSaved(true); }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [client.id]);

  async function handleSubmit() {
    if (!stars) {
      setFeedback({ error: true, text: t('rating.chooseStars') });
      return;
    }
    setSending(true);
    const ok = await dbSaveOwnRating(client.id, stars, comment);
    setSending(false);
    if (!ok) {
      setFeedback({ error: true, text: t('rating.couldNotSave') });
      return;
    }
    setSaved(true);
    setFeedback({ error: false, text: t('rating.thanks') });
  }

  const shown = hover || stars;

  return (
    <div className="col-12">
      <article className="card shadow-sm border-0">
        <div className="card-body p-4">
          <h2 className="h5">{t('rating.title')}</h2>
          <p className="text-secondary">
            {t('rating.subtitle')}
          </p>
          {loading ? (
            <p className="text-secondary small mb-0">{t('common.loading')}</p>
          ) : (
            <>
              <div
                className="d-flex gap-1 mb-3"
                style={{ fontSize: 34, lineHeight: 1, cursor: 'pointer' }}
                onMouseLeave={() => setHover(0)}
                role="radiogroup"
                aria-label={t('rating.starsAria')}
              >
                {[1, 2, 3, 4, 5].map((v) => (
                  <span
                    key={v}
                    role="radio"
                    aria-checked={stars === v}
                    aria-label={t('rating.starAria', { count: v })}
                    tabIndex={0}
                    style={{ color: v <= shown ? '#f5b301' : '#d5d9e0', transition: 'color .12s' }}
                    onClick={() => { setStars(v); setFeedback(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStars(v); setFeedback(null); } }}
                    onMouseEnter={() => setHover(v)}
                  >
                    ★
                  </span>
                ))}
              </div>
              <textarea
                className="form-control mb-3"
                rows="2"
                maxLength={1000}
                placeholder={t('rating.placeholder')}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <button className="cc-btn cc-blue" onClick={handleSubmit} disabled={sending}>
                {sending ? t('rating.sending') : saved ? t('rating.update') : t('rating.submit')}
              </button>
              {feedback && <div className={`alert mt-3 mb-0 alert-${feedback.error ? 'danger' : 'success'}`}>{feedback.text}</div>}
            </>
          )}
        </div>
      </article>
    </div>
  );
}
