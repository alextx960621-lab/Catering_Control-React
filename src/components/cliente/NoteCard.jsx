import { useState } from 'react';
import { rpc, getSessionToken } from '../../services/supabaseClient';

// Mensaje libre para el equipo, como alternativa a escribir por WhatsApp.
export default function NoteCard({ client }) {
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!text.trim()) {
      setFeedback({ error: true, text: 'Escribe un mensaje antes de enviarlo.' });
      return;
    }
    setSending(true);
    const result = await rpc('crear_nota_cliente', { p_token: getSessionToken(), p_client_id: client.id, p_texto: text });
    setSending(false);
    if (!result) {
      setFeedback({ error: true, text: 'No se pudo enviar. Intenta nuevamente o contáctanos por WhatsApp.' });
      return;
    }
    setText('');
    setFeedback({ error: false, text: '¡Mensaje enviado! El equipo se pondrá en contacto contigo.' });
  }

  return (
    <div className="col-12">
      <article className="card shadow-sm border-0">
        <div className="card-body p-4">
          <h2 className="h5">Déjanos un mensaje</h2>
          <p className="text-secondary">
            ¿Prefieres no escribir por WhatsApp? Cuéntanos qué necesitas (ej.: "Llámenme mañana para cambiar de plan") y el equipo te contacta.
          </p>
          <textarea className="form-control mb-3" rows="2" placeholder="Escribe tu mensaje…" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary" onClick={handleSend} disabled={sending}>
            {sending ? 'Enviando…' : 'Enviar mensaje'}
          </button>
          {feedback && <div className={`alert mt-3 mb-0 alert-${feedback.error ? 'danger' : 'success'}`}>{feedback.text}</div>}
        </div>
      </article>
    </div>
  );
}
