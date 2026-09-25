import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rpc, getSessionToken } from '../../services/supabaseClient';

// Mensaje libre para el equipo, como alternativa a escribir por WhatsApp
export default function NoteCard({ client }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!text.trim()) {
      setFeedback({ error: true, text: t('portal.note.empty') });
      return;
    }
    setSending(true);
    const result = await rpc('crear_nota_cliente', { p_token: getSessionToken(), p_client_id: client.id, p_texto: text });
    setSending(false);
    if (!result) {
      setFeedback({ error: true, text: t('portal.note.failed') });
      return;
    }
    setText('');
    setFeedback({ error: false, text: t('portal.note.sent') });
  }

  return (
    <div className="col-12">
      <article className="card shadow-sm border-0">
        <div className="card-body p-4">
          <h2 className="h5">{t('portal.note.title')}</h2>
          <p className="text-secondary">
            {t('portal.note.subtitle')}
          </p>
          <textarea className="form-control mb-3" rows="2" placeholder={t('portal.note.placeholder')} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="cc-btn cc-blue" onClick={handleSend} disabled={sending}>
            {sending ? t('portal.note.sending') : t('portal.note.send')}
          </button>
          {feedback && <div className={`alert mt-3 mb-0 alert-${feedback.error ? 'danger' : 'success'}`}>{feedback.text}</div>}
        </div>
      </article>
    </div>
  );
}
