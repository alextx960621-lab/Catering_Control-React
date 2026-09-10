export default function MessageAlert({ message }) {
  if (!message?.text) return null;
  return (
    <div className={`alert alert-${message.error ? 'danger' : 'warning'} mt-3 mb-0`}>
      {message.text}
      {message.showSupport && message.wa && (
        <>
          {' '}
          <a className="alert-link" href={message.wa} target="_blank" rel="noopener">
            Contactar por WhatsApp
          </a>
        </>
      )}
    </div>
  );
}
